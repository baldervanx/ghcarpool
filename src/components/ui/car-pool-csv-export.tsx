import React, { useState } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../utils/firebase';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CarPoolCSVExporter = () => {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const startDate = new Date(currentYear, currentMonth - 1, 20);
    const endDate = new Date(currentYear, currentMonth, 20);

    const q = query(
      collection(db, 'trips'),
      where('timestamp', '>=', startDate),
      where('timestamp', '<', endDate),
      orderBy('car'),
      orderBy('odo')
    );

    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs.map((doc) => doc.data());

    const header = 'Odo,Distance,User1,User2,User3,Cost,Comment,Timestamp,By User\n'    
    let csvData = '\ufeff' // Add BOM for UTF-8 encoding

    const fillArray = new Array(2).fill('');
    let currentCar = {id:''};
    for (const {
      car,
      odo,
      distance,
      users,
      cost,
      comment,
      timestamp,
      byUser
    } of docs) {
      if (car.id !== currentCar.id) {
        if (currentCar !== null) {
          csvData += '\n\n';
          csvData += `${car.id}\n`;
          csvData += header;
        }
        currentCar = car;
      }
      const userIds = users.map(user => user.id).concat(fillArray).slice(0, 3);
      csvData += `${odo},${distance || ''},${userIds.join(',')},${cost?.toFixed(2) || ''},"${comment || ''}",${timestamp.toDate().toISOString()},${byUser?.id}\n`;
    }

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ghbilpool-${endDate.toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setLoading(false);
  };

  
  return (
    <Button onClick={handleExport} disabled={loading}
      className="fixed bottom-4 left-4"
      aria-label="Export to CSV">
      <Download className="mr-2" />      
    </Button>
  );
};

export default CarPoolCSVExporter;
