import {useSelector} from "react-redux";
import type {AppStore} from "@/store";
import React, {useEffect, useState} from "react";
import {Combobox, ComboboxOptions} from "@/components/ui/combobox";
import {Label} from "@/components/ui/label";

interface DestinationSelectorProps {
    value: string,
    onChange: (destination: string) => void,
    onDistanceChange: (distance: string) => void,
    disabled?: boolean
}

export const DestinationSelector = ({
                                        value,
                                        onChange,
                                        onDistanceChange,
                                        disabled = false
                                    }: DestinationSelectorProps) => {
    const {destinations} = useSelector((state: AppStore) => state.destination);
    const [actualDestinations, setActualDestinations] = useState(destinations);
    const [selectedDestination, setSelectedDestination] = useState('');

    useEffect(() => {
        setSelectedFromName(value || "Annan");
    }, [value]);

    const setSelectedFromName = (name: string) => {
        const destObj = actualDestinations.find(d => d.name === name);
        if (destObj) {
            setSelectedDestination(destObj.id);
        } else {
            // Must here also create the custom destination entry
            setActualDestinations([...actualDestinations, {id: name, name, shortName: ""}]);
            setSelectedDestination(name);
        }
    }

    const handleDestinationChange = (option: ComboboxOptions) => {
        setSelectedDestination(option.value);
        const destination = destinations.find(d => d.id === option.value);
        if (destination) {
            onChange(destination.name);
            // The "Other" destination doesn't have a distance
            onDistanceChange(destination.distance?.toString() || "");
        } else {
            // This is the case when the custom added destination is selected.
            onChange(option.value);
            onDistanceChange("");
        }
    };

    const handleCustomDestinationChange = (label: string) => {
        onChange(label); // This will actually trigger useEffect which in turn will create it.
    };

    return (
        <div className="space-y-2">
            <Label>Destination</Label>
            <Combobox
                options={actualDestinations.map((destination): ComboboxOptions => (
                    {
                        value: destination.id,
                        label: `${destination.name} ${destination.shortName ? "(" + destination.shortName + ")" : ""}`
                    }
                ))}
                placeholder="Välj destination"
                selected={selectedDestination}
                onChange={handleDestinationChange}
                onCreate={handleCustomDestinationChange}
                disabled={disabled}
            />
        </div>
    );
};
