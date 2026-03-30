import type { RiskLevel, SourceMode } from './training-strategy';

export interface ReviewerPolicy {
  strictness: 'strict' | 'balanced' | 'lenient';
  evidenceRequired: boolean;
  allowPartialCredit: boolean;
  sourceMode?: SourceMode | string;
  riskLevel?: RiskLevel | string;
  reasonCodes: string[];
}

export function deriveReviewerPolicy(args: {
  sourceMode?: SourceMode | string;
  riskLevel?: RiskLevel | string;
}): ReviewerPolicy {
  const sourceMode = args.sourceMode;
  const riskLevel = args.riskLevel;
  const reasonCodes: string[] = [];

  const evidenceRequired = sourceMode === 'strict_grounded';
  const allowPartialCredit = sourceMode === 'template' || riskLevel === 'low';

  let strictness: ReviewerPolicy['strictness'] = 'balanced';
  if (evidenceRequired || riskLevel === 'high') strictness = 'strict';
  else if (sourceMode === 'template' && riskLevel !== 'medium') strictness = 'lenient';

  if (sourceMode === 'strict_grounded') reasonCodes.push('strict_grounded_policy');
  else if (sourceMode === 'grounded') reasonCodes.push('grounded_reference_bias');
  else if (sourceMode === 'template') reasonCodes.push('template_flexible_policy');

  if (riskLevel === 'high') reasonCodes.push('high_risk_conservative');
  else if (riskLevel === 'medium') reasonCodes.push('medium_risk_balanced');
  else if (riskLevel === 'low') reasonCodes.push('low_risk_lenient');

  if (evidenceRequired) reasonCodes.push('evidence_required');
  if (allowPartialCredit) reasonCodes.push('partial_credit_allowed');

  return {
    strictness,
    evidenceRequired,
    allowPartialCredit,
    sourceMode,
    riskLevel,
    reasonCodes,
  };
}

export function buildReviewerPrompts(args: {
  language?: string;
  question: string;
  userAnswer: string;
  points: number;
  commentPrompt?: string;
  trainingStrategy?: string;
  policy: ReviewerPolicy;
}) {
  const isZh = args.language === 'zh-CN';
  const policyBlock = isZh
    ? [
        '评审策略：',
        `- strictness: ${args.policy.strictness}`,
        `- evidenceRequired: ${args.policy.evidenceRequired}`,
        `- allowPartialCredit: ${args.policy.allowPartialCredit}`,
        `- sourceMode: ${args.policy.sourceMode || 'unknown'}`,
        `- riskLevel: ${args.policy.riskLevel || 'unknown'}`,
        `- reasonCodes: ${args.policy.reasonCodes.join(', ') || 'none'}`,
      ].join('\n')
    : [
        'Reviewer policy:',
        `- strictness: ${args.policy.strictness}`,
        `- evidenceRequired: ${args.policy.evidenceRequired}`,
        `- allowPartialCredit: ${args.policy.allowPartialCredit}`,
        `- sourceMode: ${args.policy.sourceMode || 'unknown'}`,
        `- riskLevel: ${args.policy.riskLevel || 'unknown'}`,
        `- reasonCodes: ${args.policy.reasonCodes.join(', ') || 'none'}`,
      ].join('\n');

  const trainingBlock = args.trainingStrategy
    ? `${isZh ? '训练策略参考：' : 'Training strategy context:'}\n${args.trainingStrategy}`
    : '';

  const systemPrompt = isZh
    ? `你是一位专业的教育评估专家。请根据题目、学生答案和评审策略进行评分并给出简短评语。\n必须仅输出 JSON：\n{"score": <0到${args.points}的整数>, "comment": "<一两句评语>", "reasonCodes": ["code"]}`
    : `You are a professional educational assessor. Grade the student's answer using the reviewer policy and provide brief feedback.\nYou must reply with JSON only:\n{"score": <integer from 0 to ${args.points}>, "comment": "<one or two sentences>", "reasonCodes": ["code"]}`;

  const userPrompt = isZh
    ? `题目：${args.question}\n满分：${args.points}分\n${args.commentPrompt ? `评分要点：${args.commentPrompt}\n` : ''}学生答案：${args.userAnswer}\n\n${policyBlock}${trainingBlock ? `\n\n${trainingBlock}` : ''}`
    : `Question: ${args.question}\nFull marks: ${args.points} points\n${args.commentPrompt ? `Grading guidance: ${args.commentPrompt}\n` : ''}Student answer: ${args.userAnswer}\n\n${policyBlock}${trainingBlock ? `\n\n${trainingBlock}` : ''}`;

  return { systemPrompt, userPrompt };
}

export function applyReviewerPolicy(args: {
  score: number;
  points: number;
  userAnswer: string;
  policy: ReviewerPolicy;
  reasonCodes?: string[];
}) {
  let score = Math.max(0, Math.min(args.points, Math.round(args.score)));
  const reasonCodes = [...args.policy.reasonCodes, ...(args.reasonCodes || [])];
  const answerLength = args.userAnswer.trim().length;

  if (args.policy.evidenceRequired && answerLength < 20) {
    score = Math.min(score, Math.floor(args.points * 0.4));
    reasonCodes.push('insufficient_evidence');
  }

  if (args.policy.strictness === 'strict' && answerLength < 40) {
    score = Math.min(score, Math.ceil(args.points * 0.7));
    reasonCodes.push('strict_short_answer_cap');
  }

  if (args.policy.allowPartialCredit && answerLength >= 20 && score === 0 && args.points > 1) {
    score = 1;
    reasonCodes.push('partial_credit_floor');
  }

  return { score, reasonCodes: Array.from(new Set(reasonCodes)) };
}

