import type { ReactNode } from 'react'

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div>
      <header className="topbar">
        <span className="logo">Meridian</span>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
