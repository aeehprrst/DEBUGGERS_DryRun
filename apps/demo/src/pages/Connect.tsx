import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'

export default function Connect() {
  const navigate = useNavigate()
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState(false)
  const [connected, setConnected] = useState(false)
  const [, setTick] = useState(0)

  const handleConnect = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!apiKey.startsWith('mk_')) {
      setError(true)
      return
    }
    setError(false)
    setConnected(true)
    window.setTimeout(() => navigate('/invite'), 700)
  }

  return (
    <Shell>
      <div className="card">
        <h1>Connect a data source</h1>
        <p className="subtext">
          Paste an API key to link a source to this workspace.
        </p>

        <form onSubmit={handleConnect}>
          <div className="field">
            <label htmlFor="api-key">API key</label>
            <input
              id="api-key"
              type="text"
              placeholder="mk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {error && (
              <p className="key-error">
                That key doesn't look right. Double check and try again.
              </p>
            )}
          </div>

          {connected && <p className="success-text">Source connected</p>}

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTick((t) => t + 1)}
            >
              Continue
            </button>
            <button type="submit" className="btn btn-primary">
              Connect source
            </button>
          </div>
        </form>
      </div>
    </Shell>
  )
}
