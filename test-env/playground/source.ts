/**
 * Test Source File - Named imports from barrel
 */
import { Button, Input } from '@test/ui';
import { Modal as TossModal } from '@test/ui';
import { useToggle } from '@test/ui';
import { cn, formatNumber } from '@test/ui';

export function App() {
  const [isOpen, { toggle }] = useToggle(false);
  return {
    type: 'div',
    props: { className: cn('app', 'container') },
    children: [
      Button({ variant: 'primary', children: 'Click', onClick: toggle }),
      Input({ placeholder: 'Enter...' }),
      TossModal({ isOpen, onClose: toggle, title: 'Hello' }),
      formatNumber(1234567),
    ],
  };
}
