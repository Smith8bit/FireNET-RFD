import { TextInput } from 'react-native'
import FieldBox from './FieldBox'

// A FieldBox wrapping a TextInput — the input is transparent and unpadded so the
// box supplies the background, padding, and the top-left label. `boxClassName`
// tunes the box padding; `inputClassName` the text size (defaults to text-xl).
export default function LabeledInput({
  label,
  boxClassName,
  inputClassName,
  ...props
}: {
  label: string
  boxClassName?: string
  inputClassName?: string
} & React.ComponentProps<typeof TextInput>) {
  return (
    <FieldBox label={label} className={boxClassName}>
      <TextInput
        placeholderTextColor="#9ca3af"
        {...props}
        className={`p-0 text-card-foreground ${inputClassName ?? 'text-xl'}`}
        // Fixed height + no Android font padding so the box never reflows while typing.
        style={{ height: 34, includeFontPadding: false, textAlignVertical: 'center' }}
      />
    </FieldBox>
  )
}
