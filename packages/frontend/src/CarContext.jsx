import { createContext, useContext, useState } from 'react';

const CarContext = createContext();

export const useCar = () => useContext(CarContext);

export const CarProvider = ({ children }) => {
    const [carState, setCarState] = useState({
        cars: [],
        selectedCar: '',
        lastOdometer: ''
    });

    const setSelectedCar = (car) => {
        setCarState((prevState) => ({
            ...prevState,
            selectedCar: car
        }));
    };

    return (
        <CarContext.Provider value={{ carState, setCarState, setSelectedCar }}>
            {children}
        </CarContext.Provider>
    );
};
