import { Car as CarIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedCar } from '@/store';
import type { AppStore, Car } from '@/store';
import React from 'react';

interface CarSelectorProps {
    disabled?: boolean;
    acceptChange?: (currentCar: string, newCar: string) => boolean;
    carFilter?: (cars: any[]) => any[];
}

export function CarSelector({ disabled = false, acceptChange, carFilter = undefined }: CarSelectorProps) {
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

    function doFilter(cars: Car[]): Car[] {
        if (carFilter) {
            return carFilter(cars);
        }
        return cars;
    }

    return (
      <div className="flex items-center gap-2">
        <CarIcon size={32} />
        <Select value={selectedCar} onValueChange={handleCarChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue placeholder="Välj bil..." />
          </SelectTrigger>
          <SelectContent>
            {doFilter(cars).map(car => (
                <SelectItem key={car.id} value={car.id}>
                  {car.name} ({car.id})
                </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
  );
}
