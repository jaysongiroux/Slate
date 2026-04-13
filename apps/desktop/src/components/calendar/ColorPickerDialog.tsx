import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

export const CALENDAR_COLORS = [
  "#7c5cdc",
  "#5b7ff5",
  "#36a3f7",
  "#4cc9f0",
  "#2ec4a9",
  "#4caf50",
  "#8bc34a",
  "#ffca28",
  "#ffa726",
  "#f57c00",
  "#ef5350",
  "#ec407a",
  "#ab47bc",
  "#8d6e63",
  "#78909c",
  "#546e7a",
];

export interface ColorPickerState {
  type: "subscription" | "ics";
  id: string;
  currentColor: string;
  pendingColor: string;
}

interface ColorPickerDialogProps {
  colorPicker: ColorPickerState | null;
  onColorPickerChange: (
    updater: (current: ColorPickerState | null) => ColorPickerState | null,
  ) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}

export function ColorPickerDialog({
  colorPicker,
  onColorPickerChange,
  onClose,
  onSave,
}: ColorPickerDialogProps) {
  return (
    <Dialog
      open={colorPicker !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader className="mb-0">
          <DialogTitle>Change Color</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 pt-2">
          {CALENDAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="size-8 cursor-pointer rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: color,
                borderColor: colorPicker?.pendingColor === color ? "#fff" : "transparent",
              }}
              onClick={() => {
                if (!colorPicker) return;
                onColorPickerChange((current) =>
                  current ? { ...current, pendingColor: color } : current,
                );
              }}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="dialog-secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="dialog-primary"
            type="button"
            disabled={!colorPicker || colorPicker.pendingColor === colorPicker.currentColor}
            onClick={onSave}
          >
            Save color
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
