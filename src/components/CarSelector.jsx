import { Car } from 'lucide-react';
import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useCar } from '../App';
import { collection, getDocs, doc } from 'firebase/firestore';
import { db } from '../utils/firebase';

export function CarSelector({disabled=false}) {
  const { cars, selectedCar, setCarState } = useCar();

  useEffect(() => {
    const fetchCars = async () => {
      const carsSnapshot = await getDocs(collection(db, 'cars'));
      const carsData = carsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCarState(prev => ({ ...prev, cars: carsData }));
    };

    if (cars.length === 0) {
      fetchCars();
    }
  }, []);

  const handleCarChange = async (carId) => {
    // Fetch last odometer logic from your existing code
    setCarState(prev => ({ ...prev, selectedCar: carId }));
  };

  return (
    <div className="flex items-center gap-2">
      <Car size={32} />
      <Select value={selectedCar} onValueChange={handleCarChange} disabled={disabled} >
        <SelectTrigger>
          <SelectValue placeholder="Välj bil..." />
        </SelectTrigger>
        <SelectContent>
          {cars.map(car => (
            <SelectItem key={car.id} value={car.id}>
              {car.name} ({car.id})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
