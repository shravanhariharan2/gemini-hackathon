import { DEFAULT_RULES, DEFAULT_THRESHOLDS, type ClipRules, type ClipThresholds } from '../shared/clipping';
export interface EvalConfig { rules: ClipRules; thresholds: ClipThresholds; intervalSec: number; postRollSec: number; cooldownSec: number }
export function parseEvalConfig(value: unknown = {}): EvalConfig {
  const input=value as Partial<EvalConfig>;
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid eval config.');
  const rules={...DEFAULT_RULES,...input.rules}, thresholds={...DEFAULT_THRESHOLDS,...input.thresholds};
  if(Object.keys(rules).some(k=>!Object.hasOwn(DEFAULT_RULES,k))||Object.values(rules).some(v=>typeof v!=='string'||!v.trim()||v.length>2000))throw new Error('Unknown or invalid clipping question.');
  if(Object.keys(thresholds).some(k=>!Object.hasOwn(DEFAULT_THRESHOLDS,k))||Object.values(thresholds).some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('Thresholds must be between 0 and 1.');
  const config={rules,thresholds,intervalSec:input.intervalSec??15,postRollSec:input.postRollSec??10,cooldownSec:input.cooldownSec??30};
  if(![10,15,20].includes(config.intervalSec)||!Number.isFinite(config.postRollSec)||config.postRollSec<0||config.postRollSec>20||!Number.isFinite(config.cooldownSec)||config.cooldownSec<0||config.cooldownSec>120)throw new Error('Invalid probe cadence, post-roll, or cooldown.');
  return config;
}
