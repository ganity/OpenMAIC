/**
 * Agent Registry Store
 * Manages configurable AI agents using Zustand with localStorage persistence
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentConfig } from './types';
import { getActionsForRole } from './types';
import type { TTSProviderId } from '@/lib/audio/types';
import { USER_AVATAR } from '@/lib/types/roundtable';
import type { Participant, ParticipantRole } from '@/lib/types/roundtable';
import { useUserProfileStore } from '@/lib/store/user-profile';
import type { AgentInfo } from '@/lib/generation/pipeline-types';

interface AgentRegistryState {
  agents: Record<string, AgentConfig>; // Map of agentId -> config

  // Actions
  addAgent: (agent: AgentConfig) => void;
  updateAgent: (id: string, updates: Partial<AgentConfig>) => void;
  deleteAgent: (id: string) => void;
  getAgent: (id: string) => AgentConfig | undefined;
  listAgents: () => AgentConfig[];
}

// Action types available to agents
const WHITEBOARD_ACTIONS = [
  'wb_open',
  'wb_close',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_clear',
  'wb_delete',
];

const SLIDE_ACTIONS = ['spotlight', 'laser', 'play_video'];

// Default agents - always available on both server and client
const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  'default-1': {
    id: 'default-1',
    name: '培训总监',
    role: 'teacher',
    persona: `You are the lead consultant for enterprise learning strategy. Your job is to define the positioning of a company training course with clarity, structure, and strong business relevance.

Your working style:
- Start from business goals, organizational challenges, and capability gaps
- Clarify who the training is really for and what practical outcomes it should drive
- Distinguish between "nice to know" and "must solve" issues
- Push the discussion toward a clear positioning statement, not vague learning slogans
- Synthesize different viewpoints into an actionable training direction

Use whiteboard or visual actions only when they help structure the positioning logic. Never announce your actions; focus on the consulting outcome.

Tone: Professional, strategic, concise, and persuasive.`,
    avatar: '/avatars/teacher.png',
    color: '#3b82f6',
    allowedActions: [...SLIDE_ACTIONS, ...WHITEBOARD_ACTIONS],
    priority: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
  'default-2': {
    id: 'default-2',
    name: '学习设计师',
    role: 'assistant',
    persona: `You are an instructional designer specializing in company training programs. You translate business needs into course structure, learning objectives, and practical delivery recommendations.

Your working style:
- Break broad training needs into concrete learner problems and skill targets
- Suggest suitable training formats, pacing, and module structure
- Identify what content should be taught, practiced, reinforced, or assessed
- Turn strategic direction into an implementable curriculum design
- Support the lead consultant with structured, execution-oriented thinking

Use visual actions sparingly and only when they clarify the logic of the course positioning.

Tone: Structured, practical, and solution-oriented.`,
    avatar: '/avatars/assist.png',
    color: '#10b981',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
  'default-3': {
    id: 'default-3',
    name: '业务代表',
    role: 'student',
    persona: `You represent the business side of the company. Your role is to keep the training discussion grounded in actual work scenarios, team performance, and real organizational pain points.

Your working style:
- Stress real business problems over abstract learning ideals
- Challenge vague positioning and ask whether the course will actually improve performance
- Bring up real constraints such as manager buy-in, frontline workload, and operational urgency
- Push for training that solves measurable problems, not just sounds impressive

Tone: Direct, pragmatic, and business-focused. Keep responses short and pointed.`,
    avatar: '/avatars/clown.png',
    color: '#f59e0b',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
  'default-4': {
    id: 'default-4',
    name: '学员代表',
    role: 'student',
    persona: `You represent the target learners in the company. Your role is to speak for employees who will actually attend the training, making sure the course is relevant, engaging, and realistically usable.

Your working style:
- Highlight what learners really care about, fear, or resist
- Ask whether the proposed training is too theoretical, too generic, or too detached from daily work
- Point out motivation issues, learning barriers, and adoption concerns
- Help the team shape a course positioning that learners will actually accept

Tone: Honest, practical, and concise.`,
    avatar: '/avatars/curious.png',
    color: '#ec4899',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
  'default-5': {
    id: 'default-5',
    name: '课程策略师',
    role: 'student',
    persona: `You are responsible for extracting structure from messy discussion. Your role is to summarize, categorize, and organize the company's training positioning into a form that can guide later curriculum development.

Your working style:
- Distill scattered discussion into clear bullets, categories, and decisions
- Separate target audience, pain points, objectives, and value proposition
- Notice when the team is mixing positioning, content design, and delivery details
- Help the team converge on a usable course-definition framework

Tone: Clear, organized, and concise.`,
    avatar: '/avatars/note-taker.png',
    color: '#06b6d4',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
  'default-6': {
    id: 'default-6',
    name: '组织发展顾问',
    role: 'student',
    persona: `You think from the perspective of organization development and long-term capability building. Your role is to ensure the training course is not just a short-term fix, but aligned with broader talent and organizational goals.

Your working style:
- Connect the course to leadership, culture, performance, or transformation goals
- Ask whether the proposed course builds durable capability or only addresses symptoms
- Bring in strategic perspective: scalability, sustainability, and organizational alignment
- Push the team to define why this course matters beyond the immediate request

Tone: Thoughtful, strategic, and measured.`,
    avatar: '/avatars/thinker.png',
    color: '#8b5cf6',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 6,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: true,
  },
};





/**
 * Return the built-in default agents as lightweight AgentInfo objects
 * suitable for the generation pipeline (no UI-only fields like avatar/color).
 */
export function getDefaultAgents(): AgentInfo[] {
  return Object.values(DEFAULT_AGENTS).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    persona: a.persona,
  }));
}

export const useAgentRegistry = create<AgentRegistryState>()(
  persist(
    (set, get) => ({
      // Initialize with default agents so they're available on server
      agents: { ...DEFAULT_AGENTS },

      addAgent: (agent) =>
        set((state) => ({
          agents: { ...state.agents, [agent.id]: agent },
        })),

      updateAgent: (id, updates) =>
        set((state) => ({
          agents: {
            ...state.agents,
            [id]: { ...state.agents[id], ...updates, updatedAt: new Date() },
          },
        })),

      deleteAgent: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.agents;
          return { agents: rest };
        }),

      getAgent: (id) => get().agents[id],

      listAgents: () => Object.values(get().agents),
    }),
    {
      name: 'agent-registry-storage',
      version: 11, // Bumped: add voiceOverrides field to AgentConfig
      migrate: (persistedState: unknown) => persistedState,
      // Merge persisted state with default agents
      // Default agents always use code-defined values (not cached)
      // Custom agents use persisted values
      merge: (persistedState: unknown, currentState) => {
        const persisted = persistedState as Record<string, unknown> | undefined;
        const persistedAgents = (persisted?.agents || {}) as Record<string, AgentConfig>;
        const mergedAgents: Record<string, AgentConfig> = { ...DEFAULT_AGENTS };

        // Only preserve non-default, non-generated (custom) agents from cache
        // Generated agents are loaded on-demand from IndexedDB per stage
        for (const [id, agent] of Object.entries(persistedAgents)) {
          const agentConfig = agent as AgentConfig;
          if (!id.startsWith('default-') && !agentConfig.isGenerated) {
            mergedAgents[id] = agentConfig;
          }
        }

        return {
          ...currentState,
          agents: mergedAgents,
        };
      },
    },
  ),
);

/**
 * Convert agents to roundtable participants
 * Maps agent roles to participant roles for the UI
 * @param t - i18n translation function for localized display names
 */
export function agentsToParticipants(
  agentIds: string[],
  t?: (key: string) => string,
): Participant[] {
  const registry = useAgentRegistry.getState();
  const participants: Participant[] = [];
  let hasTeacher = false;

  // Resolve agents and sort: teacher first (by role then priority desc)
  const resolved = agentIds
    .map((id) => registry.getAgent(id))
    .filter((a): a is AgentConfig => a != null);
  resolved.sort((a, b) => {
    if (a.role === 'teacher' && b.role !== 'teacher') return -1;
    if (a.role !== 'teacher' && b.role === 'teacher') return 1;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  for (const agent of resolved) {
    // Map agent role to participant role:
    // The first agent with role "teacher" becomes the left-side teacher.
    // If no agent has role "teacher", the highest-priority agent becomes teacher.
    let role: ParticipantRole = 'student';
    if (!hasTeacher) {
      role = 'teacher';
      hasTeacher = true;
    }

    // Use i18n name for default agents, fall back to registry name
    const i18nName = t?.(`settings.agentNames.${agent.id}`);
    const displayName =
      i18nName && i18nName !== `settings.agentNames.${agent.id}` ? i18nName : agent.name;

    participants.push({
      id: agent.id,
      name: displayName,
      role,
      avatar: agent.avatar,
      isOnline: true,
      isSpeaking: false,
    });
  }

  // Always add user participant — use profile store when available
  const userProfile = useUserProfileStore.getState();
  const userName = userProfile.nickname || t?.('common.you') || 'You';
  const userAvatar = userProfile.avatar || USER_AVATAR;

  participants.push({
    id: 'user-1',
    name: userName,
    role: 'user',
    avatar: userAvatar,
    isOnline: true,
    isSpeaking: false,
  });

  return participants;
}

/**
 * Load generated agents for a stage from IndexedDB into the registry.
 * Clears any previously loaded generated agents first.
 * Returns the loaded agent IDs.
 */
export async function loadGeneratedAgentsForStage(stageId: string): Promise<string[]> {
  const { getGeneratedAgentsByStageId } = await import('@/lib/utils/database');
  const records = await getGeneratedAgentsByStageId(stageId);

  if (records.length === 0) return [];

  const registry = useAgentRegistry.getState();

  // Clear previously loaded generated agents
  const currentAgents = registry.listAgents();
  for (const agent of currentAgents) {
    if (agent.isGenerated) {
      registry.deleteAgent(agent.id);
    }
  }

  // Add new ones
  const ids: string[] = [];
  for (const record of records) {
    registry.addAgent({
      ...record,
      allowedActions: getActionsForRole(record.role),
      isDefault: false,
      isGenerated: true,
      boundStageId: record.stageId,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.createdAt),
    });
    ids.push(record.id);
  }

  return ids;
}

/**
 * Save generated agents to IndexedDB and registry.
 * Clears old generated agents for this stage first.
 */
export async function saveGeneratedAgents(
  stageId: string,
  agents: Array<{
    id: string;
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
    priority: number;
    voiceConfig?: { providerId: string; voiceId: string };
  }>,
): Promise<string[]> {
  const { db } = await import('@/lib/utils/database');

  // Clear old generated agents for this stage
  await db.generatedAgents.where('stageId').equals(stageId).delete();

  // Clear from registry
  const registry = useAgentRegistry.getState();
  for (const agent of registry.listAgents()) {
    if (agent.isGenerated) registry.deleteAgent(agent.id);
  }

  // Write to IndexedDB
  const records = agents.map((a) => ({ ...a, stageId, createdAt: Date.now() }));
  await db.generatedAgents.bulkPut(records);

  // Add to registry
  for (const record of records) {
    const { voiceConfig, ...rest } = record;
    registry.addAgent({
      ...rest,
      allowedActions: getActionsForRole(record.role),
      isDefault: false,
      isGenerated: true,
      boundStageId: stageId,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.createdAt),
      ...(voiceConfig
        ? {
            voiceConfig: {
              providerId: voiceConfig.providerId as TTSProviderId,
              voiceId: voiceConfig.voiceId,
            },
          }
        : {}),
    });
  }

  return records.map((r) => r.id);
}
