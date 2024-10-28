// pages/TripLog.jsx
import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import { collection, query, where, orderBy, getDocs, doc, limit } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { useCar } from '../App';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function TripLog() {
  const [trips, setTrips] = useState([]);
  const [users, setUsers] = useState({});
  const { selectedCar } = useCar();

  useEffect(() => {
    // Hämta alla användare en gång och cacha dem
    const fetchUsers = async () => {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const usersData = {};
      usersSnapshot.docs.forEach(doc => {
        usersData[doc.id] = doc.data();
      });
      setUsers(usersData);
    };

    fetchUsers();
  }, []);

  useEffect(() => {
    const fetchTrips = async () => {
      if (!selectedCar) return;
      
      const tripsRef = collection(db, 'trips');
      const carRef = doc(db, 'cars', selectedCar);
      const q = query(
        tripsRef,
        where('car', '==', carRef),
        orderBy('timestamp', 'desc'),
        limit(20)
      );
      
      const snapshot = await getDocs(q);
      const tripsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      }));
      
      setTrips(tripsData);
    };

    fetchTrips();
  }, [selectedCar]);

  const formatDate = (date) => {
    if (!date) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const formatUsers = (userRefs) => {
    if (!userRefs) return '';
    return userRefs
      .map(ref => users[ref.id]?.id || ref.id)
      .join(', ');
  };

  const formatCost = (cost) => {
     if (!cost) return '';
     return cost.toFixed(2);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-2">
      <Card className="p-6">
        <CarSelector />
      </Card>
      
      {trips.length > 0 && (
        <Card className="p-6">
          <Table className="compact-table">
            <TableHeader>
              <TableRow>
                <TableHead style={{ padding: '0.5rem' }}>Datum</TableHead>
                <TableHead style={{ padding: '0.5rem' }} className="text-right">Odo</TableHead>
                <TableHead style={{ padding: '0.5rem' }} className="text-right">Sträcka</TableHead>
                <TableHead style={{ padding: '0.5rem' }} className="text-right">Kostnad</TableHead>
                <TableHead style={{ padding: '0.5rem' }} className="text-right">Personer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.map(trip => (
                <React.Fragment key={trip.id}>
                  <TableRow className="group">
                    <TableCell 
                      rowSpan={trip.comment ? 2 : 1}
                      style={{ padding: '0.5rem' }}
                      className="align-middle border-r group-last:border-b"
                    >
                      {formatDate(trip.timestamp)}
                    </TableCell>
                    <TableCell style={{ padding: '0.5rem' }} className="text-right">{trip.odo}</TableCell>
                    <TableCell style={{ padding: '0.5rem' }} className="text-right">{trip.distance} km</TableCell>
                    <TableCell style={{ padding: '0.5rem' }} className="text-right">{formatCost(trip.cost)}</TableCell>
                    <TableCell style={{ padding: '0.5rem' }} className="text-right">{formatUsers(trip.users)}</TableCell>
                  </TableRow>
                  {trip.comment && (
                    <TableRow className="bg-muted/50 group-hover:bg-muted/50">
                      <TableCell style={{ padding: '0.5rem' }} colSpan={4} className="italic text-muted-foreground py-2">
                        {trip.comment}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>            
          </Table>
        </Card>
      )}
    </div>
  );
}