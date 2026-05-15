export type Messages = { [key: string]: string | Messages }

export type TranslateParams = Record<string, string | number>

export type Translator = (key: string, params?: TranslateParams) => string

const getNested = (obj: Messages, path: string): unknown => {
	const segments = path.split(".")
	let current: unknown = obj
	for (const segment of segments) {
		if (typeof current !== "object" || current === null) return undefined
		current = (current as Record<string, unknown>)[segment]
	}
	return current
}

const interpolate = (template: string, params: TranslateParams | undefined): string => {
	if (!params) return template
	return template.replace(/\{(\w+)\}/g, (_, name) => {
		const value = params[name]
		return value === undefined ? `{${name}}` : String(value)
	})
}

export const createTranslator = (messages: Messages): Translator => {
	return (key, params) => {
		const value = getNested(messages, key)
		if (typeof value !== "string") return key
		return interpolate(value, params)
	}
}
