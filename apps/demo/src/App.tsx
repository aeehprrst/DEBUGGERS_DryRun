import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Signup from './pages/Signup'
import Workspace from './pages/Workspace'
import Connect from './pages/Connect'
import Invite from './pages/Invite'
import Webhook from './pages/Webhook'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/signup" replace />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/invite" element={<Invite />} />
        <Route path="/webhook" element={<Webhook />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
