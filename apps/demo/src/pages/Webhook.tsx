import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'

export default function Webhook() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [showModal, setShowModal] = useState(false)

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    navigate('/dashboard')
  }

  return (
    <Shell>
      <div className="card">
        <h1>Configure your ingestion webhook</h1>
        <p className="subtext">
          Point Meridian at an endpoint that can accept a payload envelope for
          each event. Set your backfill window and supply an idempotency key
          so retried deliveries don't create duplicates.
        </p>

        <button
          type="button"
          className="link-btn"
          onClick={() => setShowModal(true)}
        >
          Learn about webhooks
        </button>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="webhook-url">Endpoint URL</label>
            <input
              id="webhook-url"
              type="url"
              placeholder="https://"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Save webhook
          </button>
        </form>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowModal(false)}
              aria-label="Close"
            >
              &times;
            </button>
            <h2>About webhooks</h2>
            <p>
              Every delivery includes a payload envelope with an idempotency
              key. Use the backfill window setting to control how far back
              Meridian replays missed events.
            </p>
          </div>
        </div>
      )}
    </Shell>
  )
}
