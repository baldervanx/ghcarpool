import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import type { TripDto } from '@/api/trips';

const AdminTrips = () => {
  const [tripsToDelete, setTripsToDelete] = useState<TripDto[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTripsWithoutInitComment = async () => {
    const trips = await api.get<TripDto[]>('/admin/trips');
    setTripsToDelete(trips.filter(t => t.comment !== 'Init'));
  };

  const handleDeleteTrips = async () => {
    setIsDeleting(true);
    try {
      await Promise.all(tripsToDelete.map(t => api.del(`/admin/trips/${t.id}`)));
      setTripsToDelete([]);
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error deleting trips:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Admin: Trips Management</h2>
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              onClick={fetchTripsWithoutInitComment}
              disabled={isDeleting}
            >
              <Trash2 className="mr-2" /> Delete Non-Init Trips
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {tripsToDelete.length} trips that do not contain the comment "Init".
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteTrips}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Trips'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {tripsToDelete.length > 0 && (
        <div className="bg-yellow-100 p-4 rounded">
          {tripsToDelete.length} trips found without "Init" comment.
        </div>
      )}
    </div>
  );
};

export default AdminTrips;
