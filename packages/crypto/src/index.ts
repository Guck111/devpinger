import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12
const KEY_LEN = 32
const TAG_LEN = 16

export interface Cipher {
	encrypt: (plaintext: string) => string
	decrypt: (ciphertext: string) => string
}

const parseKey = (raw: string): Buffer => {
	if (!/^[0-9a-f]{64}$/i.test(raw)) {
		// We used to fall back to scrypt(raw, constant-salt) but a constant
		// salt across deployments is a footgun — operators copying the
		// library elsewhere would get a deterministic key from any string.
		// Refuse outright; the server env schema already enforces the
		// 64-hex shape, so this branch only fires when the library is
		// reused outside that schema.
		throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)")
	}
	return Buffer.from(raw, "hex")
}

export const createCipher = (rawKey: string): Cipher => {
	const key = parseKey(rawKey)
	return {
		encrypt: (plaintext) => {
			const iv = randomBytes(IV_LEN)
			const cipher = createCipheriv(ALGO, key, iv)
			const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
			const tag = cipher.getAuthTag()
			return Buffer.concat([iv, tag, encrypted]).toString("base64")
		},
		decrypt: (ciphertext) => {
			const buf = Buffer.from(ciphertext, "base64")
			if (buf.length < IV_LEN + TAG_LEN + 1) {
				throw new Error("Invalid ciphertext length")
			}
			const iv = buf.subarray(0, IV_LEN)
			const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
			const data = buf.subarray(IV_LEN + TAG_LEN)
			const decipher = createDecipheriv(ALGO, key, iv)
			decipher.setAuthTag(tag)
			const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
			return decrypted.toString("utf8")
		},
	}
}

export const generateEncryptionKey = (): string => randomBytes(KEY_LEN).toString("hex")
