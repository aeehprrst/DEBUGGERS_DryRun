import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'

export default function Invite() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    navigate('/webhook')
  }

  return (
    <Shell>
      <div className="card">
        <h1>Invite your team</h1>
        <p className="subtext">Add a teammate to help you get set up.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {}}
            >
              Back
            </button>
            <button type="submit" className="btn btn-primary">
              Send invite
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
