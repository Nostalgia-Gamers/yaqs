import { useEffect, useRef, useState } from 'react'
import type { Change } from './live'

/** A coarse clock so "12s ago" labels refresh without per-row timers. */
export function useNow(every = 5000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(t)
  }, [every])
  return now
}

const classes = ['flash-up', 'flash-down', 'flash-same']

/** Replays a flash animation on the element, colored by direction, on each change. */
export function useFlash<T extends HTMLElement>(change: Change | undefined) {
  const ref = useRef<T>(null)
  const last = useRef(change?.ts)
  useEffect(() => {
    const el = ref.current
    if (!el || !change || change.ts === last.current) return
    last.current = change.ts
    el.classList.remove(...classes)
    void el.offsetWidth
    el.classList.add(`flash-${change.dir}`)
  }, [change])
  return ref
}
