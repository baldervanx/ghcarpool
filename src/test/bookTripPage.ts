import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export class BookTripPage {
  private user = userEvent.setup();

  async selectStart(hour: string, minute: string) { await this.selectTime('Starttid', hour, minute); }
  async selectEnd(hour: string, minute: string) { await this.selectTime('Sluttid', hour, minute); }

  async setDistance(value: string) {
    const distanceInput = screen.getByRole('spinbutton');
    await this.user.clear(distanceInput);
    await this.user.type(distanceInput, value);
  }

  async setEndDate(value: string) {
    // After recurring or multi-day toggled there are two date inputs: first is start, second is end.
    const allInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    const endInput = allInputs[1];
    if (!endInput) throw new Error('End date input not found');
    await this.user.clear(endInput);
    await this.user.type(endInput, value);
  }

  async toggleRecurring() { await this.toggleById('recurring'); }
  async toggleMultiDay() { await this.toggleById('multiday'); }

  async selectRecurringDay(index: number) {
    // day checkboxes have ids day-<index>
    const cb = document.getElementById(`day-${index}`);
    if (!cb) throw new Error(`Recurring day checkbox ${index} not found`);
    await this.user.click(cb);
  }

  async submit() {
    // Button text is Swedish; detect either booking or save changes variant
    const btn = screen.getByRole('button', { name: /Boka resa|Spara ändringar/ });
    await this.user.click(btn);
  }

  async selectTime(label: string, hour: string, minute: string) {
    const hourTrigger = document.querySelector(`button[name="${label}-hour"]`);
    const minuteTrigger = document.querySelector(`button[name="${label}-minute"]`);
    if (!hourTrigger || !minuteTrigger) throw new Error(`Triggers for ${label} not found`);
    await this.openAndChoose(hourTrigger as HTMLElement, hour);
    await this.openAndChoose(minuteTrigger as HTMLElement, minute);
  }

  private async openAndChoose(trigger: HTMLElement, value: string) {
    await this.user.click(trigger);
    const opt = await screen.findByRole('option', { name: value });
    await this.user.click(opt);
  }

  private async toggleById(id: string) {
    const checkbox = document.getElementById(id);
    if (!checkbox) throw new Error(`Checkbox #${id} not found`);
    await this.user.click(checkbox);
  }
}

