import { TextInput } from 'react-native'
import FieldBox from './FieldBox'

/**
 * Single-line text input pre-wrapped in a `FieldBox` caption card.
 *
 * All standard `TextInput` props (value, onChangeText, keyboardType, etc.)
 * are forwarded via `...props`, so this stays a drop-in replacement for a
 * bare `TextInput` wherever a labeled field is needed.
 *
 * @param label - caption forwarded to `FieldBox`
 * @param boxClassName - overrides the outer `FieldBox` padding
 * @param inputClassName - overrides the input's default text size (`text-xl`)
 * @param props - remaining `TextInput` props, spread directly onto the input; `placeholderTextColor` is set before the spread so callers can still override it
 */
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
        // Fixed height + disabled font padding keeps the label and input vertically aligned across platforms.
        className={`p-0 text-card-foreground ${inputClassName ?? 'text-xl'}`}
        style={{ height: 34, includeFontPadding: false, textAlignVertical: 'center' }}
      />
    </FieldBox>
  )
}
