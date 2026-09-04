import { z } from 'zod';

import { ColumnsContainerPropsSchema as BaseColumnsContainerPropsSchema } from '@usewaypoint/block-columns-container';

const BasePropsShape = BaseColumnsContainerPropsSchema.shape.props.unwrap().unwrap().shape;

const ColumnSchema = z.object({ childrenIds: z.array(z.string()) }).passthrough();

const ColumnsContainerPropsSchema = z.object({
  style: BaseColumnsContainerPropsSchema.shape.style,
  props: z
    .object({
      ...BasePropsShape,
      columns: z.tuple([ColumnSchema, ColumnSchema, ColumnSchema]),
    })
    .passthrough()
    .optional()
    .nullable(),
});

export type ColumnsContainerProps = z.infer<typeof ColumnsContainerPropsSchema>;
export default ColumnsContainerPropsSchema;
