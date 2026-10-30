const W = 300

export function Sparkline({ values, max, color = 'var(--accent)', height = 36, label }: {
  values: (number | null)[]
  max?: number
  color?: string
  height?: number
  label: string
}) {
  const vals = values.slice(-150)
  let d = ''
  if (vals.length >= 2) {
    const top = max ?? Math.max(1, ...vals.map((v) => v ?? 0))
    const step = W / (vals.length - 1)
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      const x = i * step
      const y = height - 2 - (Math.min(v, top) / top) * (height - 4)
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      pen = true
    })
  }
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ height }}>
      {d && <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}
