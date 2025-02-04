import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

export class BookTripPage {
  // FIXME: Should this be used - and initialState?
  private component: any;
  // Constructor takes the rendered component and initial state
  constructor(component, initialState) {
    this.component = component;
  }

  // Getters for common elements
  get dateInput() {
    return screen.getByLabelText(/datum/i);
  }

  get startTimeHourSelect() {
    return screen.getAllByRole('combobox')[0];
  }

  get startTimeMinuteSelect() {
    return screen.getAllByRole('combobox')[1];
  }

  get endTimeHourSelect() {
    return screen.getAllByRole('combobox')[2];
  }

  get endTimeMinuteSelect() {
    return screen.getAllByRole('combobox')[3];
  }

  get distanceInput() {
    return screen.getByLabelText(/distans \(km\)/i);
  }

  get bookButton() {
    return screen.getByText(/boka resa/i);
  }

  get recurringCheckbox() {
    return screen.getByText(/återkommande bokning/i);
  }

  get multiDayCheckbox() {
    return screen.getByText(/flerdags bokning/i);
  }

  get recurringEndDateInput() {
    return screen.getByLabelText(/slutdatum/i);
  }

  // Interaction methods
  setDate(date) {
    fireEvent.change(this.dateInput, { target: { value: date } });
    return this;
  }

  setStartTime(hour, minute) {
    fireEvent.change(this.startTimeHourSelect, { target: { value: hour } });
    fireEvent.change(this.startTimeMinuteSelect, { target: { value: minute } });
    return this;
  }

  setEndTime(hour, minute) {
    fireEvent.change(this.endTimeHourSelect, { target: { value: hour } });
    fireEvent.change(this.endTimeMinuteSelect, { target: { value: minute } });
    return this;
  }

  setDestination(destinationName) {
    const destinationSelect = screen.getByText(/välj destination/i);
    fireEvent.click(destinationSelect);
    fireEvent.click(screen.getByText(destinationName));
    return this;
  }

  setDistance(distance) {
    fireEvent.change(this.distanceInput, { target: { value: distance } });
    return this;
  }

  enableRecurringBooking() {
    fireEvent.click(this.recurringCheckbox);
    return this;
  }

  enableMultiDayBooking() {
    fireEvent.click(this.multiDayCheckbox);
    return this;
  }

  selectRecurringDays(days) {
    // days should be an array of day names: ['Mån', 'Tis', 'Ons', ...]
    days.forEach(day => {
      fireEvent.click(screen.getByText(day));
    });
    return this;
  }

  setRecurringEndDate(date) {
    fireEvent.change(this.recurringEndDateInput, { target: { value: date } });
    return this;
  }

  submitBooking() {
    fireEvent.click(this.bookButton);
    return this;
  }

  // Validation methods
  async expectSuccessfulBooking() {
    await waitFor(() => {
      // Adjust based on your navigation or success indication
      expect(screen.getByText(/bokningsöversikt/i)).toBeInTheDocument();
    });
    return this;
  }

  async expectBookingError(errorMessage) {
    await waitFor(() => {
      expect(screen.getByText(new RegExp(errorMessage, 'i'))).toBeInTheDocument();
    });
    return this;
  }

  // Static method to render the page
  static render(component, initialState) {
    const renderResult = render(component);
    return new BookTripPage(renderResult, initialState);
  }
}
