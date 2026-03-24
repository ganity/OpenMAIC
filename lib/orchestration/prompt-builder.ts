/**
 * Prompt Builder for Stateless Generation
 *
 * Builds system prompts and converts messages for the LLM.
 */

import type { StatelessChatRequest } from '@/lib/types/chat';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { WhiteboardActionRecord, AgentTurnSummary } from './director-prompt';
import { getActionDescriptions, getEffectiveActions } from './tool-schemas';

// ==================== Role Guidelines ====================

const ROLE_GUIDELINES: Record<string, string> = {
  teacher: `Your role in this session: LEAD TRAINING CONSULTANT.
You are responsible for:
- Defining the positioning of the company training course
- Clarifying target learners, business context, and capability gaps
- Driving the discussion toward a sharp value proposition and clear course boundaries
- Synthesizing viewpoints into an actionable course positioning
- Using visual actions only when they help structure the positioning logic
You may use available actions, but analysis quality matters more than presentation tricks. Never announce your actions — just speak naturally as a consultant.`,

  assistant: `Your role in this session: LEARNING DESIGN / BUSINESS ANALYSIS CONSULTANT.
You are responsible for:
- Supporting the lead consultant with structure, examples, and practical recommendations
- Translating business needs into learner problems, learning objectives, and delivery ideas
- Filling gaps in logic and surfacing implementation considerations
- Adding execution-oriented detail without taking over the discussion
Use visual actions sparingly and only when they clarify the positioning logic.`,

  student: `Your role in this session: STAKEHOLDER OR LEARNER REPRESENTATIVE.
You are responsible for:
- Participating actively in the positioning discussion
- Raising real-world concerns, learner pain points, adoption issues, and feasibility questions
- Keeping responses SHORT and focused
- Adding one practical angle at a time rather than giving long speeches
You are NOT the lead consultant — your responses should be noticeably shorter and more pointed.`,
};

// ==================== Types ====================

/**
 * Discussion context for agent-initiated discussions
 */
interface DiscussionContext {
  topic: string;
  prompt?: string;
}

// ==================== Peer Context ====================

/**
 * Build a context section summarizing what other agents said this round.
 * Returns empty string if no agents have spoken yet.
 */
function buildPeerContextSection(
  agentResponses: AgentTurnSummary[] | undefined,
  currentAgentName: string,
): string {
  if (!agentResponses || agentResponses.length === 0) return '';

  // Filter out self (defensive — director shouldn't dispatch same agent twice)
  const peers = agentResponses.filter((r) => r.agentName !== currentAgentName);
  if (peers.length === 0) return '';

  const peerLines = peers.map((r) => `- ${r.agentName}: "${r.contentPreview}"`).join('\n');

  return `
# This Round's Context (CRITICAL — READ BEFORE RESPONDING)
The following agents have already spoken in this discussion round:
${peerLines}

You are ${currentAgentName}, responding AFTER the agents above. You MUST:
1. NOT repeat greetings or introductions — they have already been made
2. NOT restate what previous speakers already explained
3. Add NEW value from YOUR unique perspective as ${currentAgentName}
4. Build on, question, or extend what was said — do not echo it
5. If you agree with a previous point, say so briefly and then ADD something new
`;
}

// ==================== System Prompt ====================

/**
 * Build system prompt for structured output generation
 *
 * @param agentConfig - The agent configuration
 * @param storeState - Current application state
 * @param discussionContext - Optional discussion context for agent-initiated discussions
 * @returns System prompt string
 */
export function buildStructuredPrompt(
  agentConfig: AgentConfig,
  storeState: StatelessChatRequest['storeState'],
  discussionContext?: DiscussionContext,
  whiteboardLedger?: WhiteboardActionRecord[],
  userProfile?: { nickname?: string; bio?: string },
  agentResponses?: AgentTurnSummary[],
): string {
  // Determine current scene type for action filtering
  const currentScene = storeState.currentSceneId
    ? storeState.scenes.find((s) => s.id === storeState.currentSceneId)
    : undefined;
  const sceneType = currentScene?.type;

  // Filter actions by scene type (spotlight/laser only available on slides)
  const effectiveActions = getEffectiveActions(agentConfig.allowedActions, sceneType);
  const actionDescriptions = getActionDescriptions(effectiveActions);

  // Build context about current state
  const stateContext = buildStateContext(storeState);

  // Build virtual whiteboard context from ledger (shows changes by other agents this round)
  const virtualWbContext = buildVirtualWhiteboardContext(storeState, whiteboardLedger);

  // Build stakeholder context section (only when nickname or bio is present)
  const studentProfileSection =
    userProfile?.nickname || userProfile?.bio
      ? `\n# Stakeholder Context
You are advising for ${userProfile.nickname || 'a target learner or stakeholder'}.${userProfile.bio ? `\nBackground: ${userProfile.bio}` : ''}
Personalize your analysis when relevant. Refer to them naturally when it improves the course positioning discussion.\n`
      : '';

  // Build peer context section (what agents already said this round)
  const peerContext = buildPeerContextSection(agentResponses, agentConfig.name);

  // Whether spotlight/laser are available (only on slide scenes)
  const hasSlideActions =
    effectiveActions.includes('spotlight') || effectiveActions.includes('laser');

  // Build format example based on available actions
  const formatExample = hasSlideActions
    ? `[{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},{"type":"text","content":"Your natural consultant-style response"}]`
    : `[{"type":"action","name":"wb_open","params":{}},{"type":"text","content":"Your natural consultant-style response"}]`;

  // Ordering principles
  const orderingPrinciples = hasSlideActions
    ? `- spotlight/laser actions should appear BEFORE the corresponding text object (point first, then speak)
- whiteboard actions can interleave WITH text objects (draw while speaking)`
    : `- whiteboard actions can interleave WITH text objects (draw while speaking)`;

  // Good examples — include spotlight/laser examples only for slide scenes
  const spotlightExamples = hasSlideActions
    ? `[{"type":"action","name":"spotlight","params":{"elementId":"img_1"}},{"type":"text","content":"This diagram highlights the core capability gap we need to address in the training design."},{"type":"text","content":"Use it to align the course positioning with the real business problem, not just a generic learning topic."}]

[{"type":"action","name":"spotlight","params":{"elementId":"eq_1"}},{"type":"action","name":"laser","params":{"elementId":"eq_2"}},{"type":"text","content":"Compare these two models — one describes surface knowledge transfer, while the other better supports practical capability building."}]

`
    : '';

  // Action usage guidelines — conditional spotlight/laser lines
  const slideActionGuidelines = hasSlideActions
    ? `- spotlight: Use to focus attention on ONE key element. Don't overuse — max 1-2 per response.
- laser: Use to point at elements. Good for directing attention during structured analysis.
`
    : '';

  const mutualExclusionNote = hasSlideActions
    ? `- IMPORTANT — Whiteboard / Canvas mutual exclusion: The whiteboard and slide canvas are mutually exclusive. When the whiteboard is OPEN, the slide canvas is hidden — spotlight and laser actions targeting slide elements will have NO visible effect. If you need to use spotlight or laser, call wb_close first to reveal the slide canvas. Conversely, if the whiteboard is CLOSED, wb_draw_* actions still work (they implicitly open the whiteboard), but be aware that doing so hides the slide canvas.
- Prefer variety only when it improves clarity. Do not use visual actions repeatedly unless they genuinely help the analysis.`
    : '';

  const roleGuideline = ROLE_GUIDELINES[agentConfig.role] || ROLE_GUIDELINES.student;

  // Build language constraint from stage language
  const courseLanguage = storeState.stage?.language;
  const languageConstraint = courseLanguage
    ? `\n# Language (CRITICAL)\nYou MUST speak in ${courseLanguage === 'zh-CN' ? 'Chinese (Simplified)' : courseLanguage === 'en-US' ? 'English' : courseLanguage}. ALL text content in your response MUST be in this language.\n`
    : '';

  return `# Role
You are ${agentConfig.name}.

## Your Personality
${agentConfig.persona}

## Your Session Role
${roleGuideline}
${studentProfileSection}${peerContext}${languageConstraint}
# Output Format
You MUST output a JSON array for ALL responses. Each element is an object with a \`type\` field:

${formatExample}

## Format Rules
1. Output a single JSON array — no explanation, no code fences
2. \`type:"action"\` objects contain \`name\` and \`params\`
3. \`type:"text"\` objects contain \`content\` (spoken response text)
4. Action and text objects can freely interleave in any order
5. The \`]\` closing bracket marks the end of your response
6. CRITICAL: ALWAYS start your response with \`[\` — even if your previous message was interrupted. Never continue a partial response as plain text. Every response must be a complete, independent JSON array.

## Positioning Focus (CRITICAL)
Your response should help the team clarify ONE OR MORE of the following dimensions of company training course positioning:
- Target learners: who the course is really for
- Business problem: what organizational or performance issue the training should solve
- Capability gap: what learners cannot currently do well enough
- Value proposition: why this course matters and what change it should create
- Delivery strategy: suitable format, scope, timing, and practical implementation constraints
- Positioning statement: a concise definition of what this course is, for whom, and for what purpose

Prefer adding a NEW dimension or sharpening an incomplete one. Do NOT restate dimensions that are already clear unless you are challenging or refining them.

## Ordering Principles
${orderingPrinciples}

## Speech Guidelines (CRITICAL)
- Effects fire concurrently with your speech — users see results as you speak
- Text content is what you SAY OUT LOUD as a consultant or stakeholder in this training-positioning discussion
- Do NOT say "let me add...", "I'll create...", "now I'm going to..."
- Do NOT describe your actions — just speak naturally and professionally
- Users can already see action results on screen — you don't need to announce them
- Your speech should flow naturally regardless of whether actions succeed or fail
- NEVER use markdown formatting (blockquotes >, headings #, bold **, lists -, code blocks) in text content — it is spoken aloud, not rendered

## Length & Style (CRITICAL)
${buildLengthGuidelines(agentConfig.role)}

### Good Examples
${spotlightExamples}[{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_text","params":{"content":"Target Learners → Pain Points → Capability Gap → Course Value","x":100,"y":100,"fontSize":24}},{"type":"text","content":"This simple structure helps us avoid vague training ideas and define a usable course positioning."}]

[{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_table","params":{"x":100,"y":120,"width":500,"height":150,"data":[["Dimension","Definition"],["Target Learners","Who the course is for"],["Business Problem","What the training must solve"],["Value Proposition","Why this course matters"]]}},{"type":"text","content":"This framework helps align the course positioning with both learner needs and business outcomes."}]

### Bad Examples (DO NOT do this)
[{"type":"text","content":"Let me open the whiteboard"},{"type":"action",...}] (Don't announce actions!)
[{"type":"text","content":"I'm going to draw a diagram for you..."}] (Don't describe what you're doing!)
[{"type":"text","content":"Action complete, shape has been added"}] (Don't report action results!)

## Whiteboard Guidelines
${buildWhiteboardGuidelines(agentConfig.role)}

# Available Actions
${actionDescriptions}

## Action Usage Guidelines
${slideActionGuidelines}- Whiteboard actions (wb_open, wb_draw_text, wb_draw_shape, wb_draw_chart, wb_draw_latex, wb_draw_table, wb_draw_line, wb_delete, wb_clear, wb_close): Use when structuring training positioning logic, mapping stakeholder perspectives, comparing options, or organizing course-design reasoning. Prefer these actions only when they improve clarity.
- WHITEBOARD CLOSE RULE (CRITICAL): Do NOT call wb_close at the end of your response unless you specifically need to return to the slide canvas. Frequent open/close is distracting.
- wb_delete: Use to remove a specific element by its ID (shown in brackets like [id:xxx] in the whiteboard state). Prefer this over wb_clear when only one or a few elements need to be removed.
${mutualExclusionNote}

# Current State
${stateContext}
${virtualWbContext}
Remember: Speak naturally as a professional training consultant or stakeholder. Effects fire concurrently with your speech.${
    discussionContext
      ? agentResponses && agentResponses.length > 0
        ? `

# Discussion Context
Topic: "${discussionContext.topic}"
${discussionContext.prompt ? `Guiding prompt: ${discussionContext.prompt}` : ''}

You are JOINING an ongoing discussion — do NOT re-introduce the topic or greet the user again. The discussion has already started. Contribute your unique perspective, ask a focused follow-up question, or challenge an assumption made by a previous speaker.`
        : `

# Discussion Context
You are initiating a discussion on the following topic: "${discussionContext.topic}"
${discussionContext.prompt ? `Guiding prompt: ${discussionContext.prompt}` : ''}

IMPORTANT: As you are starting this discussion, frame the issue naturally and guide the team toward a sharper company training course positioning. Do not wait for user input - you speak first.`
      : ''
  }`;
}

// ==================== Length Guidelines ====================

/**
 * Build role-aware length and style guidelines.
 *
 * All agents should be concise and conversational. Student agents must be
 * significantly shorter than teacher to avoid overshadowing the teacher's role.
 */
function buildLengthGuidelines(role: string): string {
  const common = `- Length targets count ONLY your speech text (type:"text" content). Actions (spotlight, whiteboard, etc.) do NOT count toward length. Use as many actions as needed — they don't make your speech "too long."
- Speak conversationally and naturally — this is a live multi-agent strategy discussion, not a textbook. Use spoken language, not written prose.`;

  if (role === 'teacher') {
    return `- Keep your TOTAL speech text around 100 characters (across all text objects combined). Prefer 2-3 short sentences over one long paragraph.
${common}
- Focus on framing the course positioning clearly: target learners, business problem, capability gap, and value proposition.
- Push the discussion toward sharper decisions, not generic statements.`;
  }

  if (role === 'assistant') {
    return `- Keep your TOTAL speech text around 80 characters. You are a supporting role — be brief.
${common}
- Add one concrete layer per response: structure, learner needs, implementation detail, or feasibility insight.
- Do not restate the lead consultant's full framing — contribute a specific angle.`;
  }

  return `- Keep your TOTAL speech text around 50 characters. 1-2 sentences max.
${common}
- You are a stakeholder-style voice, not the lead consultant. Your responses should be shorter, sharper, and more practical.
- Speak in quick, natural interventions: a concern, a constraint, a learner reaction, or a brief insight. Not paragraphs.`;
}

// ==================== Whiteboard Guidelines ====================

/**
 * Build role-aware whiteboard guidelines.
 *
 * - Teacher / Assistant: whiteboard is available for structured analysis and coordination.
 * - Student: whiteboard is opt-in — only use it when explicitly invited by the
 *   lead consultant or the user, never proactively.
 */
function buildWhiteboardGuidelines(role: string): string {
  const common = `- Before drawing on the whiteboard, check the "Current State" section below for existing whiteboard elements.
- Do NOT redraw content that already exists — if a formula, chart, concept, or table is already on the whiteboard, reference it instead of duplicating it.
- When adding new elements, calculate positions carefully: check existing elements' coordinates and sizes in the whiteboard state, and ensure at least 20px gap between elements. Canvas size is 1000×562. All elements MUST stay within the canvas boundaries — ensure x >= 0, y >= 0, x + width <= 1000, and y + height <= 562. Never place elements that extend beyond the edges.
- If another agent has already drawn related content, build upon or extend it rather than starting from scratch.`;

  const latexGuidelines = `
### LaTeX Element Sizing (CRITICAL)
LaTeX elements have **auto-calculated width** (width = height × aspectRatio). You control **height**, and the system computes the width to preserve the formula's natural proportions. The height you specify is the ACTUAL rendered height — use it to plan vertical layout.

**Height guide by formula category:**
| Category | Examples | Recommended height |
|----------|---------|-------------------|
| Inline equations | E=mc^2, a+b=c | 50-80 |
| Equations with fractions | \\frac{-b±√(b²-4ac)}{2a} | 60-100 |
| Integrals / limits | \\int_0^1 f(x)dx, \\lim_{x→0} | 60-100 |
| Summations with limits | \\sum_{i=1}^{n} i^2 | 80-120 |
| Matrices | \\begin{pmatrix}...\\end{pmatrix} | 100-180 |
| Standalone fractions | \\frac{a}{b}, \\frac{1}{2} | 50-80 |
| Nested fractions | \\frac{\\frac{a}{b}}{\\frac{c}{d}} | 80-120 |

**Key rules:**
- ALWAYS specify height. The height you set is the actual rendered height.
- When placing elements below each other, add height + 20-40px gap.
- Width is auto-computed — long formulas expand horizontally, short ones stay narrow.
- If a formula's auto-computed width exceeds the whiteboard, reduce height.

**Multi-step derivations:**
Give each step the **same height** (e.g., 70-80px). The system auto-computes width proportionally — all steps render at the same vertical size.

### LaTeX Support
This project uses KaTeX for formula rendering, which supports virtually all standard LaTeX math commands. You may use any standard LaTeX math command freely.

- \\text{} can render English text. For non-Latin labels, use a separate TextElement.`;

  if (role === 'teacher') {
    return `- Use text elements for notes, steps, and explanations.
- Use chart elements for data visualization (bar charts, line graphs, pie charts, etc.).
- Use latex elements for mathematical formulas and scientific equations.
- Use table elements for structured data, comparisons, and organized information.
- Use shape elements sparingly — only for simple diagrams. Do not add large numbers of meaningless shapes.
- Use line elements to connect related elements, draw arrows showing relationships, or annotate diagrams. Specify arrow markers via the points parameter.
- If the whiteboard is too crowded, call wb_clear to wipe it clean before adding new elements.

### Deleting Elements
- Use wb_delete to remove a specific element by its ID (shown as [id:xxx] in whiteboard state).
- Prefer wb_delete over wb_clear when only 1-2 elements need removal.
- Common use cases: removing an outdated formula before writing the corrected version, clearing a step after explaining it to make room for the next step.

### Animation-Like Effects with Delete + Draw
All wb_draw_* actions accept an optional **elementId** parameter. When you specify elementId, you can later use wb_delete with that same ID to remove the element. This is essential for creating animation effects.
- To use: add elementId (e.g. "step1", "box_a") when drawing, then wb_delete with that elementId to remove it later.
- Step-by-step reveal: Draw step 1 (elementId:"step1") → speak → delete "step1" → draw step 2 (elementId:"step2") → speak → ...
- State transitions: Draw initial state (elementId:"state") → explain → delete "state" → draw final state
- Progressive diagrams: Draw base diagram → add elements one by one with speech between each
- Example: draw a shape at position A with elementId "obj", explain it, delete "obj", draw the same shape at position B — this creates the illusion of movement.
- Combine wb_delete (by element ID) with wb_draw_* actions to update specific parts without clearing everything.

### Layout Constraints (IMPORTANT)
The whiteboard canvas is 1000 × 562 pixels. Follow these rules to prevent element overlap:

**Coordinate system:**
- X range: 0 (left) to 1000 (right), Y range: 0 (top) to 562 (bottom)
- Leave 20px margin from edges (safe area: x 20-980, y 20-542)

**Spacing rules:**
- Maintain at least 20px gap between adjacent elements
- Vertical stacking: next_y = previous_y + previous_height + 30
- Side by side: next_x = previous_x + previous_width + 30

**Layout patterns:**
- Top-down flow: Start from y=30, stack downward with gaps
- Two-column: Left column x=20-480, right column x=520-980
- Center single element: x = (1000 - element_width) / 2

**Before adding a new element:**
- Check existing elements' positions in the whiteboard state
- Ensure your new element's bounding box does not overlap with any existing element
- If space is insufficient, use wb_delete to remove unneeded elements or wb_clear to start fresh
${latexGuidelines}
${common}`;
  }

  if (role === 'assistant') {
    return `- The whiteboard is primarily for the lead consultant's structured analysis. As an assistant, use it sparingly to supplement.
- If another agent has already set up useful content on the whiteboard, do NOT add parallel frameworks or duplicate structure — clarify verbally instead.
- Only draw on the whiteboard to sharpen the logic, add a concise supporting note, or organize a key distinction that improves the course positioning discussion.
- Limit yourself to at most 1-2 small elements per response. Prefer speech over drawing.
${latexGuidelines}
${common}`;
  }

  // Stakeholder role: suppress proactive whiteboard usage
  return `- The whiteboard is primarily for the lead consultant's structured analysis. Do NOT draw on it proactively.
- Only use whiteboard actions when the lead consultant or user explicitly invites you to write on the board.
- If no one asked you to use the whiteboard, express your ideas through speech only.
- When you ARE invited to use the whiteboard, keep it minimal and tidy — add only what was asked for.
${common}`;
}

// ==================== Element Summarization ====================

/**
 * Strip HTML tags to extract plain text
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Summarize a single PPT element into a one-line description
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PPTElement variants have heterogeneous shapes
function summarizeElement(el: any): string {
  const id = el.id ? `[id:${el.id}]` : '';
  const pos = `at (${Math.round(el.left)},${Math.round(el.top)})`;
  const size =
    el.width != null && el.height != null
      ? ` size ${Math.round(el.width)}×${Math.round(el.height)}`
      : el.width != null
        ? ` w=${Math.round(el.width)}`
        : '';

  switch (el.type) {
    case 'text': {
      const text = stripHtml(el.content || '').slice(0, 60);
      const suffix = text.length >= 60 ? '...' : '';
      return `${id} text${el.textType ? `[${el.textType}]` : ''}: "${text}${suffix}" ${pos}${size}`;
    }
    case 'image': {
      const src = el.src?.startsWith('data:') ? '[embedded]' : el.src?.slice(0, 50) || 'unknown';
      return `${id} image: ${src} ${pos}${size}`;
    }
    case 'shape': {
      const shapeText = el.text?.content ? stripHtml(el.text.content).slice(0, 40) : '';
      return `${id} shape${shapeText ? `: "${shapeText}"` : ''} ${pos}${size}`;
    }
    case 'chart':
      return `${id} chart[${el.chartType}]: labels=[${(el.data?.labels || []).slice(0, 4).join(',')}] ${pos}${size}`;
    case 'table': {
      const rows = el.data?.length || 0;
      const cols = el.data?.[0]?.length || 0;
      return `${id} table: ${rows}x${cols} ${pos}${size}`;
    }
    case 'latex':
      return `${id} latex: "${(el.latex || '').slice(0, 40)}" ${pos}${size}`;
    case 'line': {
      const lx = Math.round(el.left ?? 0);
      const ly = Math.round(el.top ?? 0);
      const sx = el.start?.[0] ?? 0;
      const sy = el.start?.[1] ?? 0;
      const ex = el.end?.[0] ?? 0;
      const ey = el.end?.[1] ?? 0;
      return `${id} line: (${lx + sx},${ly + sy}) → (${lx + ex},${ly + ey})`;
    }
    case 'video':
      return `${id} video ${pos}${size}`;
    case 'audio':
      return `${id} audio ${pos}${size}`;
    default:
      return `${id} ${el.type || 'unknown'} ${pos}${size}`;
  }
}

/**
 * Summarize an array of elements into line descriptions
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PPTElement variants have heterogeneous shapes
function summarizeElements(elements: any[]): string {
  if (elements.length === 0) return '  (empty)';

  const lines = elements.map((el, i) => `  ${i + 1}. ${summarizeElement(el)}`);

  return lines.join('\n');
}

// ==================== Virtual Whiteboard Context ====================

/**
 * Tracked element from replaying the whiteboard ledger
 */
interface VirtualWhiteboardElement {
  agentName: string;
  summary: string;
  elementId?: string; // Present for elements from initial whiteboard state
}

/**
 * Replay the whiteboard ledger to build an attributed element list.
 *
 * - wb_clear resets the accumulated elements
 * - wb_draw_* appends a new element with the agent's name
 * - wb_open / wb_close are ignored (structural, not content)
 *
 * Returns empty string when the ledger is empty (zero extra token overhead).
 */
function buildVirtualWhiteboardContext(
  _storeState: StatelessChatRequest['storeState'],
  ledger?: WhiteboardActionRecord[],
): string {
  if (!ledger || ledger.length === 0) return '';

  // Replay ledger to build current element list
  const elements: VirtualWhiteboardElement[] = [];

  for (const record of ledger) {
    switch (record.actionName) {
      case 'wb_clear':
        elements.length = 0;
        break;
      case 'wb_delete': {
        // Remove element by matching elementId from initial whiteboard state
        // (elements drawn this round don't have tracked IDs)
        const deleteId = String(record.params.elementId || '');
        const idx = elements.findIndex((el) => el.elementId === deleteId);
        if (idx >= 0) elements.splice(idx, 1);
        break;
      }
      case 'wb_draw_text': {
        const content = String(record.params.content || '').slice(0, 40);
        const x = record.params.x ?? '?';
        const y = record.params.y ?? '?';
        const w = record.params.width ?? 400;
        const h = record.params.height ?? 100;
        elements.push({
          agentName: record.agentName,
          summary: `text: "${content}${content.length >= 40 ? '...' : ''}" at (${x},${y}), size ~${w}x${h}`,
        });
        break;
      }
      case 'wb_draw_shape': {
        const shapeType = record.params.type || record.params.shape || 'rectangle';
        const x = record.params.x ?? '?';
        const y = record.params.y ?? '?';
        const w = record.params.width ?? 100;
        const h = record.params.height ?? 100;
        elements.push({
          agentName: record.agentName,
          summary: `shape(${shapeType}) at (${x},${y}), size ${w}x${h}`,
        });
        break;
      }
      case 'wb_draw_chart': {
        const chartType = record.params.chartType || record.params.type || 'bar';
        const labels = Array.isArray(record.params.labels)
          ? record.params.labels
          : (record.params.data as Record<string, unknown>)?.labels;
        const x = record.params.x ?? '?';
        const y = record.params.y ?? '?';
        const w = record.params.width ?? 350;
        const h = record.params.height ?? 250;
        elements.push({
          agentName: record.agentName,
          summary: `chart(${chartType})${labels ? `: labels=[${(labels as string[]).slice(0, 4).join(',')}]` : ''} at (${x},${y}), size ${w}x${h}`,
        });
        break;
      }
      case 'wb_draw_latex': {
        const latex = String(record.params.latex || '').slice(0, 40);
        const x = record.params.x ?? '?';
        const y = record.params.y ?? '?';
        const w = record.params.width ?? 400;
        // Estimate latex height: ~80px default for single-line, more for complex formulas
        const h = record.params.height ?? 80;
        elements.push({
          agentName: record.agentName,
          summary: `latex: "${latex}${latex.length >= 40 ? '...' : ''}" at (${x},${y}), size ~${w}x${h}`,
        });
        break;
      }
      case 'wb_draw_table': {
        const data = record.params.data as unknown[][] | undefined;
        const rows = data?.length || 0;
        const cols = (data?.[0] as unknown[])?.length || 0;
        const x = record.params.x ?? '?';
        const y = record.params.y ?? '?';
        const w = record.params.width ?? 400;
        const h = record.params.height ?? rows * 40 + 20;
        elements.push({
          agentName: record.agentName,
          summary: `table(${rows}×${cols}) at (${x},${y}), size ${w}x${h}`,
        });
        break;
      }
      case 'wb_draw_line': {
        const sx = record.params.startX ?? '?';
        const sy = record.params.startY ?? '?';
        const ex = record.params.endX ?? '?';
        const ey = record.params.endY ?? '?';
        const pts = record.params.points as string[] | undefined;
        const hasArrow = pts?.includes('arrow') ? ' (arrow)' : '';
        elements.push({
          agentName: record.agentName,
          summary: `line${hasArrow}: (${sx},${sy}) → (${ex},${ey})`,
        });
        break;
      }
      // wb_open, wb_close — skip
    }
  }

  if (elements.length === 0) return '';

  const elementLines = elements
    .map((el, i) => `  ${i + 1}. [by ${el.agentName}] ${el.summary}`)
    .join('\n');

  return `
## Whiteboard Changes This Round (IMPORTANT)
Other agents have modified the whiteboard during this discussion round.
Current whiteboard elements (${elements.length}):
${elementLines}

DO NOT redraw content that already exists. Check positions above before adding new elements.
`;
}

// ==================== State Context ====================

/**
 * Build context string from store state
 */
function buildStateContext(storeState: StatelessChatRequest['storeState']): string {
  const { stage, scenes, currentSceneId, mode, whiteboardOpen } = storeState;

  const lines: string[] = [];

  // Mode
  lines.push(`Mode: ${mode}`);

  // Whiteboard status
  lines.push(
    `Whiteboard: ${whiteboardOpen ? 'OPEN (slide canvas is hidden)' : 'closed (slide canvas is visible)'}`,
  );

  // Stage info
  if (stage) {
    lines.push(
      `Course: ${stage.name || 'Untitled'}${stage.description ? ` - ${stage.description}` : ''}`,
    );
  }

  // Scenes summary
  lines.push(`Total scenes: ${scenes.length}`);

  if (currentSceneId) {
    const currentScene = scenes.find((s) => s.id === currentSceneId);
    if (currentScene) {
      lines.push(
        `Current scene: "${currentScene.title}" (${currentScene.type}, id: ${currentSceneId})`,
      );

      // Slide scene: include element details
      if (currentScene.content.type === 'slide') {
        const elements = currentScene.content.canvas.elements;
        lines.push(`Current slide elements (${elements.length}):\n${summarizeElements(elements)}`);
      }

      // Quiz scene: include question summary
      if (currentScene.content.type === 'quiz') {
        const questions = currentScene.content.questions;
        const qSummary = questions
          .slice(0, 5)
          .map((q, i) => `  ${i + 1}. [${q.type}] ${q.question.slice(0, 80)}`)
          .join('\n');
        lines.push(
          `Quiz questions (${questions.length}):\n${qSummary}${questions.length > 5 ? `\n  ... and ${questions.length - 5} more` : ''}`,
        );
      }
    }
  } else if (scenes.length > 0) {
    lines.push('No scene currently selected');
  }

  // List first few scenes
  if (scenes.length > 0) {
    const sceneSummary = scenes
      .slice(0, 5)
      .map((s, i) => `  ${i + 1}. ${s.title} (${s.type}, id: ${s.id})`)
      .join('\n');
    lines.push(
      `Scenes:\n${sceneSummary}${scenes.length > 5 ? `\n  ... and ${scenes.length - 5} more` : ''}`,
    );
  }

  // Whiteboard content (last whiteboard in the stage)
  if (stage?.whiteboard && stage.whiteboard.length > 0) {
    const lastWb = stage.whiteboard[stage.whiteboard.length - 1];
    const wbElements = lastWb.elements || [];
    lines.push(
      `Whiteboard (last of ${stage.whiteboard.length}, ${wbElements.length} elements):\n${summarizeElements(wbElements)}`,
    );
  }

  return lines.join('\n');
}

// ==================== Conversation Summary ====================

/**
 * OpenAI message format (used by director)
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Summarize conversation history for the director agent
 *
 * Produces a condensed text summary of the last N messages,
 * truncating long messages and including role labels.
 *
 * @param messages - OpenAI-format messages to summarize
 * @param maxMessages - Maximum number of recent messages to include (default 10)
 * @param maxContentLength - Maximum content length per message (default 200)
 */
export function summarizeConversation(
  messages: OpenAIMessage[],
  maxMessages = 10,
  maxContentLength = 200,
): string {
  if (messages.length === 0) {
    return 'No conversation history yet.';
  }

  const recent = messages.slice(-maxMessages);
  const lines = recent.map((msg) => {
    const roleLabel =
      msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    const content =
      msg.content.length > maxContentLength
        ? msg.content.slice(0, maxContentLength) + '...'
        : msg.content;
    return `[${roleLabel}] ${content}`;
  });

  return lines.join('\n');
}

// ==================== Message Conversion ====================

/**
 * Convert UI messages to OpenAI format
 * Includes tool call information so the model knows what actions were taken
 */
export function convertMessagesToOpenAI(
  messages: StatelessChatRequest['messages'],
  currentAgentId?: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => {
      if (msg.role === 'assistant') {
        // Assistant messages use JSON array format to serve as few-shot examples
        // that match the expected output format from the system prompt
        const items: Array<{ type: string; [key: string]: string }> = [];

        if (msg.parts) {
          for (const part of msg.parts) {
            const p = part as Record<string, unknown>;

            if (p.type === 'text' && p.text) {
              items.push({ type: 'text', content: p.text as string });
            } else if ((p.type as string)?.startsWith('action-') && p.state === 'result') {
              const actionName = (p.actionName ||
                (p.type as string).replace('action-', '')) as string;
              const output = p.output as Record<string, unknown> | undefined;
              const isSuccess = output?.success === true;
              const resultSummary = isSuccess
                ? output?.data
                  ? `result: ${JSON.stringify(output.data).slice(0, 100)}`
                  : 'success'
                : (output?.error as string) || 'failed';
              items.push({
                type: 'action',
                name: actionName,
                result: resultSummary,
              });
            }
          }
        }

        const content = items.length > 0 ? JSON.stringify(items) : '';
        const msgAgentId = msg.metadata?.agentId;

        // When currentAgentId is provided and this message is from a DIFFERENT agent,
        // convert to user role with agent name attribution
        if (currentAgentId && msgAgentId && msgAgentId !== currentAgentId) {
          const agentName = msg.metadata?.senderName || msgAgentId;
          return {
            role: 'user' as const,
            content: content ? `[${agentName}]: ${content}` : '',
          };
        }

        return {
          role: 'assistant' as const,
          content,
        };
      }

      // User messages: keep plain text concatenation
      const contentParts: string[] = [];

      if (msg.parts) {
        for (const part of msg.parts) {
          const p = part as Record<string, unknown>;

          if (p.type === 'text' && p.text) {
            contentParts.push(p.text as string);
          } else if ((p.type as string)?.startsWith('action-') && p.state === 'result') {
            const actionName = (p.actionName ||
              (p.type as string).replace('action-', '')) as string;
            const output = p.output as Record<string, unknown> | undefined;
            const isSuccess = output?.success === true;
            const resultSummary = isSuccess
              ? output?.data
                ? `result: ${JSON.stringify(output.data).slice(0, 100)}`
                : 'success'
              : (output?.error as string) || 'failed';
            contentParts.push(`[Action ${actionName}: ${resultSummary}]`);
          }
        }
      }

      // Extract speaker name from metadata (e.g. other agents' messages in discussion)
      const senderName = msg.metadata?.senderName;
      let content = contentParts.join('\n');
      if (senderName) {
        content = `[${senderName}]: ${content}`;
      }

      // Annotate interrupted messages so the LLM knows context was cut short
      const isInterrupted =
        (msg as unknown as Record<string, unknown>).metadata &&
        ((msg as unknown as Record<string, unknown>).metadata as Record<string, unknown>)
          ?.interrupted;
      return {
        role: 'user' as const,
        content: isInterrupted
          ? `${content}\n[This response was interrupted — do NOT continue it. Start a new JSON array response.]`
          : content,
      };
    })
    .filter((msg) => {
      // Drop empty messages and messages with only dots/ellipsis/whitespace
      // (produced by failed agent streams)
      const stripped = msg.content.replace(/[.\s…]+/g, '');
      return stripped.length > 0;
    });
}
