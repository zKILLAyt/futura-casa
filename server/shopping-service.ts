import { type ItemStatus, type PrismaClient } from '@prisma/client';

export async function updateShoppingItemStatus(client: PrismaClient, householdId: string, actorId: string, itemId: string, status: ItemStatus) {
  return client.$transaction(async transaction => {
    const result = await transaction.shoppingItem.updateMany({
      where: { id: itemId, householdId },
      data: { status },
    });
    if (result.count === 0) return null;

    const item = await transaction.shoppingItem.findFirst({
      where: { id: itemId, householdId },
      include: { responsible: { select: { id: true, name: true } } },
    });
    if (!item) return null;

    await transaction.activityLog.create({
      data: {
        householdId,
        actorId,
        action: 'atualizou',
        entity: 'item',
        entityId: item.id,
        description: `${item.name}: status ${status}`,
      },
    });
    return item;
  });
}
