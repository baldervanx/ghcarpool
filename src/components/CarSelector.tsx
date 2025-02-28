// components/CarSelector.jsx
import { Car } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedCar } from '@/store';
import type { AppStore } from '@/store';
import React from 'react';

interface CarSelectorProps {
    disabled?: boolean;
    acceptChange?: (currentCar: string, newCar: string) => boolean;
}

export function CarSelector({ disabled = false, acceptChange }: CarSelectorProps) {
  const dispatch = useDispatch();
  const { cars, selectedCar } = useSelector((state: AppStore) => state.car);

  const handleCarChange = (carId: string) => {
      let doDispatch = acceptChange == undefined;
      if (acceptChange) {
          doDispatch = acceptChange(selectedCar, carId);
      }
      if (doDispatch) {
          dispatch(setSelectedCar(carId));
      }
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
