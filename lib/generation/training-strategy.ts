export type TrainingType =
  | 'onboarding'
  | 'policy'
  | 'process'
  | 'system'
  | 'skill'
  | 'product'
  | 'safety'
  | 'general';

export type TemplateFamily = TrainingType;
export type SourceMode = 'strict_grounded' | 'grounded' | 'template';
export type RiskLevel = 'high' | 'medium' | 'low';
export type DeliveryMode = 'online' | 'offline' | 'hybrid';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type StrategyFieldSource =
  | 'user_input'
  | 'inferred_from_text'
  | 'inferred_from_docs'
  | 'confirmed_by_dialog'
  | 'defaulted_by_system';

export interface TrainingStrategy {
  trainingType: TrainingType;
  templateFamily: TemplateFamily;
  sourceMode: SourceMode;
  riskLevel: RiskLevel;
  deliveryMode?: DeliveryMode;
  assessmentNeeded: boolean;
  outputFocus: string[];
  mustInclude: string[];
  forbidden: string[];
}

export interface TemplateSelectionResult extends TrainingStrategy {
  confidence: {
    overall: ConfidenceLevel;
    trainingType: ConfidenceLevel;
    templateFamily: ConfidenceLevel;
    sourceMode: ConfidenceLevel;
    riskLevel: ConfidenceLevel;
  };
  fieldSources: {
    trainingType: StrategyFieldSource;
    templateFamily: StrategyFieldSource;
    sourceMode: StrategyFieldSource;
    riskLevel: StrategyFieldSource;
    assessmentNeeded: StrategyFieldSource;
  };
  clarificationNeeded?: boolean;
  clarificationQuestions?: string[];
  selectionReason?: string;
}

export interface TemplateSelectionOverrides {
  trainingType?: TrainingType;
  templateFamily?: TemplateFamily;
  sourceMode?: SourceMode;
  riskLevel?: RiskLevel;
  deliveryMode?: DeliveryMode;
  assessmentNeeded?: boolean;
}

export interface TemplateSelectorUiDecision {
  mode: 'direct_generate' | 'lightweight_selector' | 'clarification_then_selector';
  confidence: ConfidenceLevel;
  showClarification: boolean;
  showLightweightSelector: boolean;
}

const TEMPLATE_CONFIG: Record<TemplateFamily, Omit<TrainingStrategy, 'trainingType' | 'templateFamily'>> = {
  onboarding: { sourceMode: 'template', riskLevel: 'low', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['role clarity', 'new hire journey', 'expectations', 'common questions'], mustInclude: ['overview', 'key process', 'faq'], forbidden: ['legal claims without source'] },
  policy: { sourceMode: 'strict_grounded', riskLevel: 'high', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['rules', 'boundaries', 'exceptions', 'consequences'], mustInclude: ['policy basis', 'compliance boundary', 'knowledge check'], forbidden: ['invented policy clauses', 'unsupported penalties'] },
  process: { sourceMode: 'grounded', riskLevel: 'medium', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['steps', 'roles', 'handoff', 'exceptions'], mustInclude: ['workflow', 'key checkpoints'], forbidden: ['missing step dependencies'] },
  system: { sourceMode: 'grounded', riskLevel: 'medium', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['entry point', 'step-by-step operation', 'result feedback', 'common errors'], mustInclude: ['step list', 'error handling'], forbidden: ['invented UI fields', 'invented buttons'] },
  skill: { sourceMode: 'template', riskLevel: 'low', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['scenarios', 'mistakes', 'practice', 'transfer'], mustInclude: ['scenario', 'practice'], forbidden: ['pure theory dump'] },
  product: { sourceMode: 'grounded', riskLevel: 'medium', deliveryMode: 'online', assessmentNeeded: true, outputFocus: ['product knowledge', 'business application', 'faq'], mustInclude: ['core concepts', 'faq'], forbidden: ['unsupported capability claims'] },
  safety: { sourceMode: 'strict_grounded', riskLevel: 'high', deliveryMode: 'offline', assessmentNeeded: true, outputFocus: ['risk identification', 'prevention', 'emergency response'], mustInclude: ['risk points', 'response steps'], forbidden: ['invented emergency procedures'] },
  general: { sourceMode: 'template', riskLevel: 'low', deliveryMode: 'online', assessmentNeeded: false, outputFocus: ['concept overview', 'key takeaways'], mustInclude: ['overview'], forbidden: [] },
};

const HIGH_RISK_TYPES: TrainingType[] = ['policy', 'safety'];
const ENTERPRISE_GROUNDED_TYPES: TrainingType[] = ['policy', 'process', 'system', 'product', 'safety'];

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function bumpConfidence(current: ConfidenceLevel, next: ConfidenceLevel): ConfidenceLevel {
  const order: ConfidenceLevel[] = ['low', 'medium', 'high'];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

function lowerConfidence(current: ConfidenceLevel, next: ConfidenceLevel): ConfidenceLevel {
  const order: ConfidenceLevel[] = ['low', 'medium', 'high'];
  return order.indexOf(next) < order.indexOf(current) ? next : current;
}

function analyzeDocumentSupport(requirement: string, documentHints?: string) {
  const combined = `${requirement || ''}\n${documentHints || ''}`.toLowerCase();
  const hasDocumentText = Boolean(documentHints?.trim());
  const evidenceSignals = [
    '制度', '政策', '条款', '规范', '附件', '手册', '操作手册', '用户手册', '指南', '流程图',
    'sop', '截图', '界面', '页面', '按钮', '字段', '步骤', '编号', '版本', '第', '章', '节',
    'clause', 'policy', 'manual', 'workflow', 'screenshot', 'screen', 'field', 'button',
  ];
  const strongEvidenceSignals = [
    '第1', '第2', '第一章', '第二章', '条款', '附件', '截图', '页面', '按钮', '字段', '审批',
    '操作步骤', '流程图', '制度全文', 'policy clause', 'section', 'step 1', 'step 2', 'screen',
  ];
  const insufficiencySignals = [
    '暂无', '没有资料', '无附件', '先生成', '示例', '模板', '大概', '参考即可', '待补充',
    'later', 'no document', 'placeholder', 'example only',
  ];

  const evidenceCount = evidenceSignals.filter((signal) => combined.includes(signal)).length;
  const strongEvidenceCount = strongEvidenceSignals.filter((signal) => combined.includes(signal)).length;
  const insufficient = insufficiencySignals.some((signal) => combined.includes(signal));

  const evidenceStrength: ConfidenceLevel = strongEvidenceCount >= 2 || evidenceCount >= 4
    ? 'high'
    : strongEvidenceCount >= 1 || evidenceCount >= 2
      ? 'medium'
      : 'low';

  const completeness: ConfidenceLevel = !hasDocumentText
    ? 'low'
    : insufficient
      ? 'low'
      : evidenceStrength === 'high'
        ? 'high'
        : evidenceStrength === 'medium'
          ? 'medium'
          : 'low';

  return { hasDocumentText, evidenceStrength, completeness, insufficient };
}

function resolveSourceMode(
  type: TrainingType,
  base: Omit<TrainingStrategy, 'trainingType' | 'templateFamily'>,
  support: ReturnType<typeof analyzeDocumentSupport>,
): {
  sourceMode: SourceMode;
  riskLevel: RiskLevel;
  sourceConfidence: ConfidenceLevel;
  clarificationQuestions: string[];
  selectionReason: string;
} {
  const clarificationQuestions: string[] = [];
  let sourceMode = base.sourceMode;
  let riskLevel = base.riskLevel;
  let sourceConfidence: ConfidenceLevel = support.hasDocumentText ? 'medium' : 'low';

  if (HIGH_RISK_TYPES.includes(type)) {
    sourceMode = 'strict_grounded';
    sourceConfidence = support.completeness === 'high' ? 'high' : 'medium';
    if (support.completeness !== 'high') {
      clarificationQuestions.push('请补充企业内部制度原文、合规条款、应急预案或正式SOP，避免生成企业特定规则时失真。');
    }
    return {
      sourceMode,
      riskLevel,
      sourceConfidence,
      clarificationQuestions,
      selectionReason: `high-risk template=${type}; docCompleteness=${support.completeness}; evidence=${support.evidenceStrength}`,
    };
  }

  if (type === 'system') {
    riskLevel = support.completeness === 'low' ? 'high' : 'medium';
    sourceMode = support.completeness === 'high' ? 'grounded' : 'strict_grounded';
    sourceConfidence = support.completeness === 'high' ? 'high' : 'medium';
    if (support.completeness !== 'high') {
      clarificationQuestions.push('是否能提供系统截图、字段说明、按钮名称或操作手册？系统培训缺少这些材料时只能采用更保守模式。');
    }
    return {
      sourceMode,
      riskLevel,
      sourceConfidence,
      clarificationQuestions,
      selectionReason: `system training; docCompleteness=${support.completeness}; evidence=${support.evidenceStrength}`,
    };
  }

  if (type === 'process') {
    if (support.hasDocumentText && support.completeness !== 'low') {
      sourceMode = 'grounded';
      sourceConfidence = bumpConfidence(sourceConfidence, support.completeness);
    } else {
      sourceMode = 'template';
      sourceConfidence = lowerConfidence(sourceConfidence, 'medium');
      clarificationQuestions.push('如果这是企业内部流程培训，是否有SOP、审批流或角色分工说明可供引用？');
    }
    return {
      sourceMode,
      riskLevel,
      sourceConfidence,
      clarificationQuestions,
      selectionReason: `process training; docCompleteness=${support.completeness}; evidence=${support.evidenceStrength}`,
    };
  }

  if (type === 'product') {
    sourceMode = support.completeness === 'high' ? 'grounded' : support.hasDocumentText ? 'template' : 'template';
    sourceConfidence = support.completeness === 'high' ? 'high' : support.hasDocumentText ? 'medium' : 'low';
    if (support.hasDocumentText && support.completeness === 'low') {
      clarificationQuestions.push('如需按企业产品资料准确生成，请补充产品手册、FAQ、能力边界或销售材料。');
    }
    return {
      sourceMode,
      riskLevel,
      sourceConfidence,
      clarificationQuestions,
      selectionReason: `product training; docCompleteness=${support.completeness}; evidence=${support.evidenceStrength}`,
    };
  }

  if (ENTERPRISE_GROUNDED_TYPES.includes(type) && support.hasDocumentText && support.completeness !== 'low') {
    sourceMode = 'grounded';
    sourceConfidence = bumpConfidence(sourceConfidence, support.completeness);
  } else if (!support.hasDocumentText && base.sourceMode === 'template') {
    sourceMode = 'template';
    sourceConfidence = 'medium';
  }

  return {
    sourceMode,
    riskLevel,
    sourceConfidence,
    clarificationQuestions,
    selectionReason: `default sourceMode resolution; template=${type}; docCompleteness=${support.completeness}; evidence=${support.evidenceStrength}`,
  };
}

function detectTrainingType(requirement: string): { type: TrainingType; confidence: ConfidenceLevel } {
  const text = requirement.toLowerCase();
  if (includesAny(text, ['入职', '新人', 'onboarding', 'new hire'])) return { type: 'onboarding', confidence: 'high' };
  if (includesAny(text, ['制度', '合规', '规范', 'policy', 'compliance'])) return { type: 'policy', confidence: 'high' };
  if (includesAny(text, ['流程', 'sop', '审批', 'process', 'workflow'])) return { type: 'process', confidence: 'high' };
  if (includesAny(text, ['系统', '操作', '页面', '按钮', 'erp', 'crm', 'system'])) return { type: 'system', confidence: 'high' };
  if (includesAny(text, ['销售', '沟通', '领导力', '技能', 'skill', 'presentation'])) return { type: 'skill', confidence: 'medium' };
  if (includesAny(text, ['产品', '方案', '服务', 'product'])) return { type: 'product', confidence: 'medium' };
  if (includesAny(text, ['安全', '应急', '事故', 'safety', 'ehs'])) return { type: 'safety', confidence: 'high' };
  return { type: 'general', confidence: 'low' };
}

export function inferTemplateSelection(args: { requirement: string; hasDocuments?: boolean; documentHints?: string }): TemplateSelectionResult {
  const requirement = args.requirement || '';
  const { type, confidence } = detectTrainingType(requirement);
  const base = TEMPLATE_CONFIG[type];
  const support = analyzeDocumentSupport(requirement, args.documentHints);
  const hasDocuments = Boolean(args.hasDocuments || support.hasDocumentText);
  const dynamic = resolveSourceMode(type, base, support);

  const clarificationQuestions = [...dynamic.clarificationQuestions];
  if (confidence === 'low') {
    clarificationQuestions.push('本次培训更偏制度规则说明、流程操作讲解，还是通用能力提升？');
  }
  if (!hasDocuments && (type === 'policy' || type === 'system' || type === 'safety')) {
    clarificationQuestions.push('是否有企业内部制度、SOP、系统截图或操作手册可供引用？');
  }

  const overall: ConfidenceLevel = clarificationQuestions.length > 0
    ? (confidence === 'high' && dynamic.sourceConfidence === 'high' ? 'medium' : 'low')
    : lowerConfidence(dynamic.sourceConfidence, confidence);

  return {
    trainingType: type,
    templateFamily: type,
    sourceMode: dynamic.sourceMode,
    riskLevel: dynamic.riskLevel,
    deliveryMode: base.deliveryMode,
    assessmentNeeded: base.assessmentNeeded,
    outputFocus: base.outputFocus,
    mustInclude: base.mustInclude,
    forbidden: base.forbidden,
    confidence: {
      overall,
      trainingType: confidence,
      templateFamily: confidence,
      sourceMode: dynamic.sourceConfidence,
      riskLevel: dynamic.riskLevel === 'high' ? 'high' : dynamic.riskLevel === 'medium' ? 'medium' : 'low',
    },
    fieldSources: {
      trainingType: 'inferred_from_text',
      templateFamily: 'inferred_from_text',
      sourceMode: hasDocuments ? 'inferred_from_docs' : 'defaulted_by_system',
      riskLevel: hasDocuments ? 'inferred_from_docs' : 'defaulted_by_system',
      assessmentNeeded: 'defaulted_by_system',
    },
    clarificationNeeded: clarificationQuestions.length > 0,
    clarificationQuestions,
    selectionReason: `${dynamic.selectionReason}; hasDocuments=${hasDocuments}`,
  };
}

export function shouldShowTemplateSelector(args: {
  confidence: ConfidenceLevel;
  clarificationNeeded?: boolean;
  manualOverrideAllowed?: boolean;
}): TemplateSelectorUiDecision {
  const showClarification = Boolean(args.clarificationNeeded || args.confidence === 'low');
  const showLightweightSelector = Boolean(args.manualOverrideAllowed && args.confidence !== 'high');

  if (showClarification) {
    return {
      mode: 'clarification_then_selector',
      confidence: args.confidence,
      showClarification: true,
      showLightweightSelector,
    };
  }

  if (showLightweightSelector) {
    return {
      mode: 'lightweight_selector',
      confidence: args.confidence,
      showClarification: false,
      showLightweightSelector: true,
    };
  }

  return {
    mode: 'direct_generate',
    confidence: args.confidence,
    showClarification: false,
    showLightweightSelector: false,
  };
}

export function applyTemplateSelectionOverrides(
  selection: TemplateSelectionResult,
  overrides: TemplateSelectionOverrides,
): TemplateSelectionResult {
  const next: TemplateSelectionResult = {
    ...selection,
    ...overrides,
    fieldSources: {
      ...selection.fieldSources,
      trainingType: overrides.trainingType ? 'confirmed_by_dialog' : selection.fieldSources.trainingType,
      templateFamily: overrides.templateFamily ? 'confirmed_by_dialog' : selection.fieldSources.templateFamily,
      sourceMode: overrides.sourceMode ? 'confirmed_by_dialog' : selection.fieldSources.sourceMode,
      riskLevel: overrides.riskLevel ? 'confirmed_by_dialog' : selection.fieldSources.riskLevel,
      assessmentNeeded:
        typeof overrides.assessmentNeeded === 'boolean'
          ? 'confirmed_by_dialog'
          : selection.fieldSources.assessmentNeeded,
    },
    selectionReason: [selection.selectionReason, 'manual_override']
      .filter(Boolean)
      .join('; '),
  };

  if (overrides.trainingType || overrides.templateFamily) {
    const family = overrides.templateFamily || overrides.trainingType || selection.templateFamily;
    const base = TEMPLATE_CONFIG[family];
    next.trainingType = overrides.trainingType || family;
    next.templateFamily = family;
    next.outputFocus = base.outputFocus;
    next.mustInclude = base.mustInclude;
    next.forbidden = base.forbidden;
    next.deliveryMode = overrides.deliveryMode ?? next.deliveryMode ?? base.deliveryMode;
    if (typeof overrides.assessmentNeeded !== 'boolean') {
      next.assessmentNeeded = base.assessmentNeeded;
    }
  }

  next.clarificationNeeded = false;
  next.clarificationQuestions = [];
  next.confidence = {
    ...selection.confidence,
    overall: 'high',
    trainingType: overrides.trainingType ? 'high' : selection.confidence.trainingType,
    templateFamily: overrides.templateFamily ? 'high' : selection.confidence.templateFamily,
    sourceMode: overrides.sourceMode ? 'high' : selection.confidence.sourceMode,
    riskLevel: overrides.riskLevel ? 'high' : selection.confidence.riskLevel,
  };

  return next;
}


export function formatTemplateFamilyPrompt(_selection: TemplateSelectionResult): string {
  return '';
}

export function formatReviewPolicyPrompt(_selection: TemplateSelectionResult): string {
  return '';
}

export function formatTrainingStrategyForPrompt(selection: TemplateSelectionResult): string {
  return [
    '## Training Strategy',
    `- trainingType: ${selection.trainingType}`,
    `- templateFamily: ${selection.templateFamily}`,
    `- sourceMode: ${selection.sourceMode}`,
    `- riskLevel: ${selection.riskLevel}`,
    `- assessmentNeeded: ${selection.assessmentNeeded ? 'yes' : 'no'}`,
    `- outputFocus: ${selection.outputFocus.join(', ') || 'none'}`,
    `- mustInclude: ${selection.mustInclude.join(', ') || 'none'}`,
    `- forbidden: ${selection.forbidden.join(', ') || 'none'}`,
    `- confidence: ${selection.confidence.overall}`,
    selection.clarificationNeeded && selection.clarificationQuestions?.length ? `- clarificationQuestions: ${selection.clarificationQuestions.join(' | ')}` : '',
    'Use this strategy to bias structure and emphasis. If sourceMode is strict_grounded, do not invent enterprise-specific rules, UI elements, process steps, or emergency procedures beyond the provided materials.',
  ].filter(Boolean).join('\n');
}

