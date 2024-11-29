// components/CarSelector.jsx
import { Car } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDispatch, useSelector } from 'react-redux';
import { setCarState } from '../store';

export function CarSelector({ disabled = false }) {
  const dispatch = useDispatch();
  const { cars, selectedCar } = useSelector(state => state.car);

  const handleCarChange = (carId) => {
    dispatch(setCarState({ selectedCar: carId }));
  };

  return (
      <div className="flex items-center gap-2">
        <Car size={32} />
        <Select value={selectedCar} onValueChange={handleCarChange} disabled={disabled}>
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
