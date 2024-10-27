import React from 'react'
import OdometerTracker from './components/OdometerTracker'

function App() {
  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-center mb-8">
          <h1 className="text-4xl font-bold text-primary">Goda Händer Bilpool</h1>
        </div>
        <OdometerTracker />
      </div>
    </div>
  )
}

export default App