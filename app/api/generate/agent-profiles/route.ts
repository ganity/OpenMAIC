/**
 * Agent Profiles Generation API
 *
 * Generates agent profiles (teacher, assistant, student) for a course stage
 * based on stage info and scene outlines.
 */

import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { GenerationMetadata } from '@/lib/types/generation';
import { formatTemplateFamilyPrompt } from '@/lib/generation/template-prompt-config';

const log = createLogger('Agent Profiles API');

export const maxDuration = 120;

const COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
  '#84cc16',
  '#a855f7',
];

interface RequestBody {
  stageInfo: { name: string; description?: string };
  sceneOutlines?: { title: string; description?: string }[];
  language: string;
  availableAvatars: string[];
  avatarDescriptions?: Array<{ path: string; desc: string }>;
  availableVoices?: Array<{ providerId: string; voiceId: string; voiceName: string }>;
  metadata?: GenerationMetadata;
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

function buildAgentProfilesPrompt(args: {
  stageInfo: RequestBody['stageInfo'];
  sceneOutlines?: RequestBody['sceneOutlines'];
  language: string;
  availableAvatars: string[];
  avatarDescriptions?: RequestBody['avatarDescriptions'];
  voicePrompt: string;
  voiceJsonField: string;
  metadata?: GenerationMetadata;
}) {
  const sceneSummary = args.sceneOutlines?.length
    ? args.sceneOutlines.map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`).join('\n')
    : null;
  const templateFamilyPrompt = formatTemplateFamilyPrompt(args.metadata?.trainingStrategy);

  const systemPrompt = `You are an expert enterprise learning strategist. Generate agent profiles for a multi-agent company training course positioning discussion. Decide the appropriate number of agents (typically 3-5) based on the course topic and organizational complexity. Keep the role values compatible with the existing system: exactly one "teacher" agent as the lead consultant, and the rest as "assistant" or "student" style stakeholder voices. Return ONLY valid JSON, no markdown or explanation.`;

  const userPrompt = `Generate agent profiles for the following company training course discussion:

Course name: ${args.stageInfo.name}
${args.stageInfo.description ? `Course description: ${args.stageInfo.description}` : ''}
${sceneSummary ? `\nScene outlines:\n${sceneSummary}\n` : ''}
${templateFamilyPrompt ? `\nTemplate family guidance:\n${templateFamilyPrompt}\n` : ''}
Requirements:
- Decide the appropriate number of agents based on the training topic and organizational complexity (typically 3-5)
- Exactly 1 agent must have role "teacher"; this role represents the lead training consultant
- The remaining agents can be "assistant" or "student", but their personas should represent learning design, business, learner, or organization stakeholder perspectives
- Priority values: teacher=10 (highest), assistant=7, student=4-6
- Each agent needs: name, role, persona (2-3 sentences describing their professional perspective, responsibilities, and discussion style for company training course positioning)
- Names and personas must be in language: ${args.language}
- Agent mix must reflect the template family guidance above. For policy/safety, prefer stricter compliance and risk-aware personas. For skill/product, prefer scenario, practice, learner adoption, and business application perspectives.
- Each agent must be assigned one avatar from this list: ${JSON.stringify(args.avatarDescriptions && args.avatarDescriptions.length > 0 ? args.avatarDescriptions.map((a) => ({ path: a.path, description: a.desc })) : args.availableAvatars)}
  - Pick an avatar that visually matches the agent's personality and role
  - Try to use different avatars for each agent
  - Use the "path" value as the avatar field in the output
- Each agent must be assigned one color from this list: ${JSON.stringify(COLOR_PALETTE)}
  - Each agent must have a different color
${args.voicePrompt}

Return a JSON object with this exact structure:
{
  "agents": [
    {
      "name": "string",
      "role": "teacher" | "assistant" | "student",
      "persona": "string (2-3 sentences)",
      "avatar": "string (from available list)",
      "color": "string (hex color from palette)",
      "priority": number (10 for teacher, 7 for assistant, 4-6 for student)${args.voiceJsonField}
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const {
      stageInfo,
      sceneOutlines,
      language,
      availableAvatars,
      avatarDescriptions,
      availableVoices,
      metadata,
    } = body;

    // ── Validate required fields ──
    if (!stageInfo?.name) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageInfo.name is required');
    }
    if (!language) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'language is required');
    }
    if (!availableAvatars || availableAvatars.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'availableAvatars is required and must not be empty',
      );
    }

    // ── Model resolution from request headers ──
    const { model: languageModel, modelString } = resolveModelFromHeaders(req);

    // ── Build prompt ──
    const voiceListStr =
      availableVoices && availableVoices.length > 0
        ? JSON.stringify(
            availableVoices.map((v) => ({
              id: `${v.providerId}::${v.voiceId}`,
              name: v.voiceName,
            })),
          )
        : '';

    const voicePrompt = voiceListStr
      ? `- Each agent should be assigned a voice that matches their persona from this list: ${voiceListStr}
  - Pick a voice that suits the agent's professional style and role (e.g. authoritative for lead consultant, practical for stakeholder, clear and structured for instructional designer)
  - Try to use different voices for each agent`
      : '';

    const voiceJsonField = voiceListStr
      ? ',\n      "voice": "string (voice id from available list, e.g. \'qwen-tts::Cherry\')"'
      : '';

    const { systemPrompt, userPrompt } = buildAgentProfilesPrompt({
      stageInfo,
      sceneOutlines,
      language,
      availableAvatars,
      avatarDescriptions,
      voicePrompt,
      voiceJsonField,
      metadata,
    });

    log.info(`Generating agent profiles for "${stageInfo.name}" [model=${modelString}]`);

    const result = await callLLM(
      {
        model: languageModel,
        system: systemPrompt,
        prompt: userPrompt,
      },
      'agent-profiles',
    );

    // ── Parse LLM response ──
    const rawText = stripCodeFences(result.text);
    let parsed: {
      agents: Array<{
        name: string;
        role: string;
        persona: string;
        avatar: string;
        color: string;
        priority: number;
        voice?: string;
      }>;
    };

    try {
      parsed = JSON.parse(rawText);
    } catch {
      log.error('Failed to parse LLM response as JSON:', rawText.substring(0, 500));
      return apiError('PARSE_FAILED', 500, 'Failed to parse agent profiles from LLM response');
    }

    // ── Validate parsed structure ──
    if (!parsed.agents || !Array.isArray(parsed.agents) || parsed.agents.length < 2) {
      log.error(`Expected at least 2 agents, got ${parsed.agents?.length ?? 0}`);
      return apiError(
        'GENERATION_FAILED',
        500,
        `Expected at least 2 agents but LLM returned ${parsed.agents?.length ?? 0}`,
      );
    }

    const teacherCount = parsed.agents.filter((a) => a.role === 'teacher').length;
    if (teacherCount !== 1) {
      log.error(`Expected exactly 1 teacher, got ${teacherCount}`);
      return apiError(
        'GENERATION_FAILED',
        500,
        `Expected exactly 1 teacher but LLM returned ${teacherCount}`,
      );
    }

    // ── Build output with IDs ──
    const agents = parsed.agents.map((agent, index) => {
      // Parse voice "providerId::voiceId" format
      let voiceConfig: { providerId: string; voiceId: string } | undefined;
      if (agent.voice && agent.voice.includes('::')) {
        const [providerId, voiceId] = agent.voice.split('::');
        if (providerId && voiceId) {
          voiceConfig = { providerId, voiceId };
        }
      }

      return {
        id: `gen-${nanoid(8)}`,
        name: agent.name,
        role: agent.role,
        persona: agent.persona,
        avatar: agent.avatar || availableAvatars[index % availableAvatars.length],
        color: agent.color || COLOR_PALETTE[index % COLOR_PALETTE.length],
        priority:
          agent.priority ?? (agent.role === 'teacher' ? 10 : agent.role === 'assistant' ? 7 : 5),
        ...(voiceConfig ? { voiceConfig } : {}),
      };
    });

    log.info(`Successfully generated ${agents.length} agent profiles for "${stageInfo.name}"`);

    return apiSuccess({ agents });
  } catch (error) {
    log.error('Agent profiles generation error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
