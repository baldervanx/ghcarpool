import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import { collection, query, where, orderBy, getDocs, doc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { useCar } from '../App';

export function TripLog() {
  const [trips, setTrips] = useState([]);
  const { selectedCar } = useCar();

  useEffect(() => {
    const fetchTrips = async () => {
      if (!selectedCar) return;
      
      const tripsRef = collection(db, 'trips');
      const carRef = doc(db, 'cars', selectedCar);
      const q = query(
        tripsRef,
        where('car', '==', carRef),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const tripsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      }));
      
      setTrips(tripsData);
    };

    fetchTrips();
  }, [selectedCar]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Card className="p-6">
        <CarSelector />
      </Card>
      
      {trips.length > 0 && (
        <Card className="p-6">
          <div className="space-y-4">
            {trips.map(trip => (
              <div key={trip.id} className="border-b pb-4">
                <div className="flex justify-between">
                  <div>
                    <p className="font-medium">Mätarställning: {trip.odo}</p>
                    <p>Sträcka: {trip.distance} km</p>
                    <p>Kostnad: {trip.cost}</p>
                    {trip.comment && <p>Kommentar: {trip.comment}</p>}
                  </div>
                  <div className="text-right">
                    <p>{trip.timestamp?.toLocaleDateString()}</p>
                    <p>{trip.timestamp?.toLocaleTimeString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
