export const CUSTOMER_TABLE_MIN_WIDTH = 820;
export const CUSTOMER_ADDRESS_MIN_WIDTH = 1040;

export function getCustomerListLayout(availableWidth: number) {
  return {
    showTable: availableWidth >= CUSTOMER_TABLE_MIN_WIDTH,
    showAddressColumn: availableWidth >= CUSTOMER_ADDRESS_MIN_WIDTH,
  };
}
