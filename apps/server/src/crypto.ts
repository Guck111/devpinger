import { createCipher } from "@devpinger/crypto"
import { env } from "./config.js"

export const cipher = createCipher(env.ENCRYPTION_KEY)
