import { describe, expect, it } from 'vitest';

import {
  applyTemplateSelectionOverrides,
  inferTemplateSelection,
  shouldShowTemplateSelector,
  type TemplateSelectorUiDecision,
} from '@/lib/generation/training-strategy';

describe('training-strategy selector flow', () => {
  it('keeps high-risk policy training in strict_grounded mode without documents', () => {
    const result = inferTemplateSelection({
      requirement: '请帮我生成一门企业合规制度培训，讲清处罚边界和例外情况',
      hasDocuments: false,
    });

    expect(result.templateFamily).toBe('policy');
    expect(result.sourceMode).toBe('strict_grounded');
    expect(result.riskLevel).toBe('high');
    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestions?.length).toBeGreaterThan(0);
  });

  it('upgrades process training to grounded when document evidence is sufficient', () => {
    const result = inferTemplateSelection({
      requirement: '为审批流程培训生成课程，覆盖角色分工与异常处理',
      hasDocuments: true,
      documentHints: 'SOP 第1章 审批步骤，第2章 角色分工，包含流程图、审批节点、异常处理与回退规则',
    });

    expect(result.templateFamily).toBe('process');
    expect(result.sourceMode).toBe('grounded');
    expect(result.confidence.sourceMode).toBe('high');
    expect(result.clarificationNeeded).toBe(false);
  });

  it('recommends lightweight selector on medium confidence and questions on low confidence', () => {
    const mediumDecision: TemplateSelectorUiDecision = shouldShowTemplateSelector({
      confidence: 'medium',
      clarificationNeeded: false,
      manualOverrideAllowed: true,
    });
    const lowDecision = shouldShowTemplateSelector({
      confidence: 'low',
      clarificationNeeded: true,
      manualOverrideAllowed: true,
    });

    expect(mediumDecision.mode).toBe('lightweight_selector');
    expect(lowDecision.mode).toBe('clarification_then_selector');
  });

  it('merges manual overrides while preserving compatibility defaults', () => {
    const inferred = inferTemplateSelection({
      requirement: '新员工入职培训，帮助了解组织和常见问题',
      hasDocuments: false,
    });

    const overridden = applyTemplateSelectionOverrides(inferred, {
      templateFamily: 'skill',
      trainingType: 'skill',
      assessmentNeeded: false,
    });

    expect(overridden.templateFamily).toBe('skill');
    expect(overridden.trainingType).toBe('skill');
    expect(overridden.assessmentNeeded).toBe(false);
    expect(overridden.fieldSources.templateFamily).toBe('confirmed_by_dialog');
    expect(overridden.fieldSources.trainingType).toBe('confirmed_by_dialog');
    expect(overridden.selectionReason).toContain('manual_override');
  });
});

