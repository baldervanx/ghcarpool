import {useSelector} from "react-redux";
import type {AppStore} from "@/store";
import React, {useCallback, useEffect, useState} from "react";
import {Combobox, ComboboxOptions} from "@/components/ui/combobox";
import {Label} from "@/components/ui/label";

interface DestinationSelectorProps {
    // value är ett destinations-ID (CUID) eller tom sträng
    value: string,
    // onChange anropas med destinations-ID (inte namn)
    onChange: (destinationId: string) => void,
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

    // Hittar rätt intern selected baserat på ett inkommande ID eller namn (bakåtkompatibilitet)
    const resolveSelected = useCallback((val: string) => {
        if (!val) { setSelectedDestination(''); return; }

        // Primärt: matcha på ID (det normala fallet — backend skickar ID)
        const byId = actualDestinations.find(d => d.id === val);
        if (byId) { setSelectedDestination(byId.id); return; }

        // Fallback: matcha på namn (äldre data eller manuell inmatning)
        const byName = actualDestinations.find(d => d.name === val);
        if (byName) { setSelectedDestination(byName.id); return; }

        // Fritext som inte matchar — skapa temporär post
        setActualDestinations(prev => {
            if (prev.some(d => d.id === val)) return prev;
            return [...prev, {id: val, name: val, shortName: ""}];
        });
        setSelectedDestination(val);
    }, [actualDestinations]);

    useEffect(() => {
        resolveSelected(value);
    }, [value, resolveSelected]);

    const handleDestinationChange = (option: ComboboxOptions) => {
        setSelectedDestination(option.value);
        const destination = destinations.find(d => d.id === option.value);
        if (destination) {
            // Skicka ID till parent (inte namn — undviker FK-violation i backend)
            onChange(destination.id);
            onDistanceChange(destination.distance?.toString() || "");
        } else {
            // Fritext/anpassad destination — option.value är friteksten
            onChange(option.value);
            onDistanceChange("");
        }
    };

    const handleCustomDestinationChange = (label: string) => {
        // Fritext: parent håller texten som ID-placeholder tills den sparas
        onChange(label);
    };

    return (
        <div className="flex flex-col space-y-2">
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
