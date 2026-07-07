import { TextInput } from 'react-native'
import FieldBox from './FieldBox'

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
        style={{ height: 34, includeFontPadding: false, textAlignVertical: 'center' }}
      />
    </FieldBox>
  )
}
