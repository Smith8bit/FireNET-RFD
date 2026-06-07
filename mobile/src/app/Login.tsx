import { Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useState } from "react"
import { Link } from "expo-router"

export default function Login() {

    const [passwordHidden, setPasswordHidden] = useState(true)

    return (
        <SafeAreaView>
            <View>
                <Text>ระบบจัดการไฟป่า (หน่วยดับไฟ)</Text>
                <View>
                    <Text>อีเมล</Text>
                    <TextInput
                        placeholder="email@example.com"
                        keyboardType="email-address"
                        textContentType="emailAddress"
                    />
                </View>
                <View>
                    <Text>รหัสผ่าน</Text>
                    <TextInput 
                        secureTextEntry={passwordHidden}
                        textContentType="password"
                        placeholder="••••••••"
                    />
                </View>
                <Link href="/Register">สมัคร</Link>
            </View>
        </SafeAreaView>
    )
}