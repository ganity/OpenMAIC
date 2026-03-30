import type { TemplateSelectionResult, TemplateFamily } from './training-strategy';

export interface TemplatePromptConfig {
  family: TemplateFamily;
  focusTitle: string;
  reviewPolicy: string[];
}

const TEMPLATE_PROMPT_CONFIG: Record<TemplateFamily, TemplatePromptConfig> = {
  onboarding: {
    family: 'onboarding',
    focusTitle: 'Onboarding / assimilation',
    reviewPolicy: ['prioritize role clarity and expectations', 'include newcomer FAQ and first-week actions'],
  },
  policy: {
    family: 'policy',
    focusTitle: 'Policy / compliance',
    reviewPolicy: ['treat unsupported rules as invalid', 'emphasize boundary, exception, and consequence checks'],
  },
  process: {
    family: 'process',
    focusTitle: 'Process / SOP',
    reviewPolicy: ['check step order and handoff clarity', 'highlight checkpoints and exception handling'],
  },
  system: {
    family: 'system',
    focusTitle: 'System operation',
    reviewPolicy: ['avoid invented UI fields or buttons', 'ensure steps, entry points, and error handling are explicit'],
  },
  skill: {
    family: 'skill',
    focusTitle: 'Skill training',
    reviewPolicy: ['prioritize scenarios, mistakes, practice, and transfer', 'avoid pure theory dump'],
  },
  product: {
    family: 'product',
    focusTitle: 'Product / service knowledge',
    reviewPolicy: ['check business value and scenario fit', 'avoid unsupported capability claims'],
  },
  safety: {
    family: 'safety',
    focusTitle: 'Safety / emergency',
    reviewPolicy: ['require risk points and emergency response steps', 'reject invented emergency procedures'],
  },
  general: {
    family: 'general',
    focusTitle: 'General knowledge',
    reviewPolicy: ['keep structure clear and practical', 'retain concise overview and takeaways'],
  },
};

export function formatTemplateFamilyPrompt(strategy?: TemplateSelectionResult): string {
  if (!strategy) return '';
  const config = TEMPLATE_PROMPT_CONFIG[strategy.templateFamily];
  return [
    '## Template Family Focus',
    `- family: ${config.family}`,
    `- focusTitle: ${config.focusTitle}`,
    `- outputFocus: ${strategy.outputFocus.join(', ') || 'none'}`,
    `- mustInclude: ${strategy.mustInclude.join(', ') || 'none'}`,
    `- forbidden: ${strategy.forbidden.join(', ') || 'none'}`,
    `- reviewPolicy: ${config.reviewPolicy.join(' | ')}`,
  ].join('\n');
}

export function formatReviewPolicyPrompt(strategy?: TemplateSelectionResult): string {
  if (!strategy) return '';
  const config = TEMPLATE_PROMPT_CONFIG[strategy.templateFamily];
  return [
    '## Reviewer Policy',
    `- family: ${config.family}`,
    `- sourceMode: ${strategy.sourceMode}`,
    `- riskLevel: ${strategy.riskLevel}`,
    `- reviewPolicy: ${config.reviewPolicy.join(' | ')}`,
  ].join('\n');
}

