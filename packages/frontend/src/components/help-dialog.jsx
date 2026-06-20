import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HelpCircle } from 'lucide-react';

const HelpDialog = () => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('booking');

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Hjälp"
        className="fixed bottom-4 right-4 rounded-full h-12 w-12 shadow-lg [&_svg]:size-8"
      >
        <HelpCircle size={24} />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl">Hjälp & Instruktioner</DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col max-h-[80vh]">
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="booking">Bokning</TabsTrigger>
              <TabsTrigger value="logging">Loggning</TabsTrigger>
              <TabsTrigger value="other">Övrigt</TabsTrigger>
            </TabsList>

            <TabsContent value="booking" className="flex-grow overflow-y-scroll">
              <div className="space-y-6">
                <section className="space-y-2">
                  <h3 className="text-lg font-semibold">Boka bil</h3>
                  <p>
                    Instruktioner om special-fallen kommer, grunderna är förhoppningsvis självförklarande.
                  </p>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="logging" className="flex-grow overflow-y-auto">
                <div className="space-y-6 p-1">
                  <section className="space-y-2">
                    <h3 className="text-lg font-semibold">Att fyllas</h3>
                    <p>
                      Det finns enstaka delar av loggning som kan behöva förklaras lite närmare.
                    </p>
                  </section>
                </div>
            </TabsContent>

            <TabsContent value="other" className="flex-grow overflow-y-auto">
                <div className="space-y-6 p-1">
                  <section className="space-y-2">
                    <h3 className="text-lg font-semibold">Övrigt</h3>
                    <p>
                      Sådant som inte passar i de andra två kategorierna.
                    </p>
                  </section>
                </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default HelpDialog;
