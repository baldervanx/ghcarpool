// components/UserSelector.jsx
import React from 'react';
import { User } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import MultipleSelector from '@/components/ui/multiple-selector';
import { setSelectedUsers } from '../store';

const UserSelector = ({ disabled }) => {
    const dispatch = useDispatch();
    const { users, selectedUsers } = useSelector(state => state.user);

    const handleSelectionChange = (selectedOptions) => {
        const selectedIds = selectedOptions ? selectedOptions.map(option => option.value) : [];
        dispatch(setSelectedUsers(selectedIds));
    };

    const userOptions = users.map(user => ({
        value: user.id,
        badgeLabel: `${user.shortName}`,
        label: `${user.name}`
    }));

    const selectedValues = userOptions.filter(option => selectedUsers.includes(option.value));

    return (
        <div className="flex items-center gap-2">
            <User size={32} />
            <MultipleSelector
                value={selectedValues}
                onChange={handleSelectionChange}
                options={userOptions}
                maxSelected={3}
                hidePlaceholderWhenSelected={true}
                hideClearAllButton={true}
                placeholder="Välj personer"
                disabled={disabled}
            />
        </div>
    );
};

export default UserSelector;
