type ClassValue = string | false | null | undefined

/** Joins class names, dropping the falsy branches of conditionals. */
export function cn(...values: ClassValue[]): string {
	return values.filter(Boolean).join(' ')
}
