import { createValue } from '../store';

export const toasts = createValue<{ id: number; msg: string }[]>([]);
let n = 0;
export function toast(msg: string, ms = 3200) {
  const id = ++n;
  toasts.set([...toasts.get(), { id, msg }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), ms);
}
