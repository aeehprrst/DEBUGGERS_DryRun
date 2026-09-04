import Shell from '../components/Shell'

export default function Dashboard() {
  return (
    <Shell>
      <div className="card">
        <h1>Your workspace is ready</h1>
        <p className="subtext">
          Signup, data source, team invite, and webhook are all set up.
        </p>
      </div>
    </Shell>
  )
}
