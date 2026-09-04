import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'

export default function Workspace() {
  const navigate = useNavigate()
  const [name, setName] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    navigate('/connect')
  }

  return (
    <Shell>
      <div className="card">
        <h1>Create your workspace</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="workspace-name">Workspace name</label>
            <input
              id="workspace-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="filler">
            <h2>Why workspaces matter</h2>
            <p>
              A workspace is the container for everything your team does in
              Meridian. Every dashboard, every connected source, and every
              teammate you invite lives inside a single workspace, so it is
              worth taking a moment to understand how it fits into the rest
              of the product before you continue.
            </p>
            <p>
              Most teams start with one workspace per company, and only split
              into multiple workspaces once they have a real reason to keep
              data or permissions separate — for example, a services company
              running Meridian on behalf of several clients, or an
              organization that wants a hard boundary between a production
              environment and a sandbox used for testing.
            </p>
            <p>
              Naming matters more than people expect. Workspace names show up
              in shared links, in exported reports, and in the emails your
              teammates receive when they're invited, so a clear, recognizable
              name saves a surprising amount of confusion three months from
              now when someone is trying to find the right one in a list of
              a dozen.
            </p>
            <p>
              Billing, seats, and data retention are all configured at the
              workspace level, not the account level. That means the plan you
              choose, the number of teammates you invite, and how long
              Meridian keeps your historical data are all scoped to this
              workspace specifically, and can be changed later from the
              workspace settings page without affecting any other workspace
              you might create.
            </p>
            <p>
              Once your workspace is created, the next step is connecting a
              data source. Meridian doesn't do anything useful until it has
              somewhere to pull data from, so plan on having credentials for
              at least one source ready before you move on to that step.
            </p>
            <p>
              You can rename a workspace, transfer ownership, or archive it
              entirely at any time from the admin settings, and none of those
              actions are destructive — archiving simply hides the workspace
              from the picker without deleting any underlying data, so there
              is very little risk in experimenting here while you get set up.
            </p>
          </div>

          <button type="submit" className="btn btn-primary">
            Create workspace
          </button>
        </form>
      </div>
    </Shell>
  )
}
