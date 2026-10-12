// Session names made by the grove skills all start the same way (grove-design-, grove-implement-),
// so the part that tells them apart comes last. Splitting the shared lead off lets a row mute it.
export function splitTitleLead(title: string): { lead: string; rest: string } {
  const m = /^(grove-[a-z]+-)(.+)$/.exec(title)
  return m ? { lead: m[1], rest: m[2] } : { lead: '', rest: title }
}
