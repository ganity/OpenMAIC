/**
 * Quiz Grading API
 *
 * POST: Receives a text question + user answer, calls LLM for scoring and feedback.
 * Used for short-answer (text) questions that cannot be graded locally.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { appendTelemetryEvent } from '@/lib/server/telemetry';
import {
  applyReviewerPolicy,
  buildReviewerPrompts,
  deriveReviewerPolicy,
} from '@/lib/generation/reviewer-policy';
const log = createLogger('Quiz Grade');

interface GradeRequest {
  question: string;
  userAnswer: string;
  points: number;
  commentPrompt?: string;
  language?: string;
  trainingStrategy?: string;
  sourceMode?: string;
  riskLevel?: string;
}

interface GradeResponse {
  score: number;
  comment: string;
  reasonCodes?: string[];
  policyApplied?: {
    strictness: 'strict' | 'balanced' | 'lenient';
    evidenceRequired: boolean;
    allowPartialCredit: boolean;
    sourceMode?: string;
    riskLevel?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GradeRequest;
    const { question, userAnswer, points, commentPrompt, language, trainingStrategy, sourceMode, riskLevel } = body;

    if (!question || !userAnswer) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'question and userAnswer are required');
    }

    // Resolve model from request headers
    const { model: languageModel } = resolveModelFromHeaders(req);

    const policy = deriveReviewerPolicy({ sourceMode, riskLevel });
    const { systemPrompt, userPrompt } = buildReviewerPrompts({
      language,
      question,
      userAnswer,
      points,
      commentPrompt,
      trainingStrategy,
      policy,
    });

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'quiz-grade',
    );

    // Parse the LLM response as JSON
    const text = result.text.trim();
    let gradeResult: GradeResponse;

    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      const gated = applyReviewerPolicy({
        score: Number(parsed.score),
        points,
        userAnswer,
        policy,
        reasonCodes: Array.isArray(parsed.reasonCodes)
          ? parsed.reasonCodes.map((code: unknown) => String(code))
          : [],
      });
      gradeResult = {
        score: gated.score,
        comment: String(parsed.comment || ''),
        reasonCodes: gated.reasonCodes,
        policyApplied: {
          strictness: policy.strictness,
          evidenceRequired: policy.evidenceRequired,
          allowPartialCredit: policy.allowPartialCredit,
          sourceMode: policy.sourceMode,
          riskLevel: policy.riskLevel,
        },
      };
    } catch {
      // Fallback: give partial credit with a generic comment
      const fallbackScore = policy.allowPartialCredit ? Math.max(1, Math.round(points * 0.5)) : 0;
      gradeResult = {
        score: fallbackScore,
        comment:
          language === 'zh-CN'
            ? '已作答，请参考标准答案。'
            : 'Answer received. Please refer to the standard answer.',
        reasonCodes: [...policy.reasonCodes, 'fallback_parse_error'],
        policyApplied: {
          strictness: policy.strictness,
          evidenceRequired: policy.evidenceRequired,
          allowPartialCredit: policy.allowPartialCredit,
          sourceMode: policy.sourceMode,
          riskLevel: policy.riskLevel,
        },
      };
    }

    await appendTelemetryEvent({
      eventType: 'quiz_grade_result',
      payload: {
        score: gradeResult.score,
        points,
        language: language || 'unknown',
        sourceMode: sourceMode || 'unknown',
        riskLevel: riskLevel || 'unknown',
        hasTrainingStrategy: Boolean(trainingStrategy),
        reasonCodes: gradeResult.reasonCodes || [],
        policyApplied: gradeResult.policyApplied || null,
      },
    });

    return apiSuccess({ ...gradeResult });
  } catch (error) {
    log.error('Error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to grade answer');
  }
}
