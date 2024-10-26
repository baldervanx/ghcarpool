import React from 'react'
import OdometerTracker from './components/OdometerTracker'

function App() {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Car Odometer Tracker</h1>
        <OdometerTracker />
      </div>
    </div>
  )
}

export default App
