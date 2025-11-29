import Button from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/Button.js";
import Input from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/Input.js";
import TossModal from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/Modal.js";
import useToggle from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/hooks/useToggle.js";
import cn from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/utils/cn.js";
import formatNumber from "C:/Users/csw21/barrel-optimizer/test-env/node_modules/@test/ui/dist/utils/format.js";
export function App() {
    const [isOpen, { toggle }] = useToggle(false);
    return {
        type: 'div',
        props: {
            className: cn('app', 'container')
        },
        children: [
            Button({
                variant: 'primary',
                children: 'Click',
                onClick: toggle
            }),
            Input({
                placeholder: 'Enter...'
            }),
            TossModal({
                isOpen,
                onClose: toggle,
                title: 'Hello'
            }),
            formatNumber(1234567)
        ]
    };
}
