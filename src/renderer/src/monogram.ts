// The two letters that stand for a project in the collapsed rail: the initials of its first two
// words (`spatial-intelligence` is SI), or its first two letters when it is a single word.
export function monogram(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length === 0) return ''
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  return letters.toUpperCase()
}
