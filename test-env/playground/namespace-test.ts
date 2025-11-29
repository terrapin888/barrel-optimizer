/**
 * Namespace Import Test - Should bail out
 */
import * as UI from '@test/ui';

export function Page() {
  return UI.Button({ children: 'Namespace Button' });
}
