import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import React from "react";

interface TimeSelectorProps {
    value: string,
    onChange: (time: string) => void,
    label: string,
    disabled?: boolean
}

export const TimeSelector = ({value, onChange, label, disabled=false}: TimeSelectorProps) => {
    const hours = Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0'));
    const minutes = ['00', '15', '30', '45'];

    const [selectedHour, selectedMinute] = value ? value.split(':') : ['', ''];

    const handleHourChange = (hour: string) => {
        onChange(`${hour}:${selectedMinute || '00'}`);
    };

    const handleMinuteChange = (minute: string) => {
        onChange(`${selectedHour || '00'}:${minute}`);
    };

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex gap-1">
                <Select value={selectedHour} onValueChange={handleHourChange} disabled={disabled}>
                    <SelectTrigger className="flex-1 px-1.5 time-select-trigger">
                        <SelectValue placeholder="--"/>
                    </SelectTrigger>
                    <SelectContent>
                        {hours.map((hour) => (
                            <SelectItem key={hour} value={hour}>
                                {hour}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={selectedMinute} onValueChange={handleMinuteChange} disabled={disabled}>
                    <SelectTrigger className="flex-1 px-1.5 time-select-trigger">
                        <SelectValue placeholder="00"/>
                    </SelectTrigger>
                    <SelectContent>
                        {minutes.map((minute) => (
                            <SelectItem key={minute} value={minute}>
                                {minute}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
};
