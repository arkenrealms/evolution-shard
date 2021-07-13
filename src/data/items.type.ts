export enum ItemsBonusType {
    FIRE = 'fire',
    SWIMMING = 'swimming',
    CLIMBING = 'climbing',
  }
  
  export enum ItemsMainCategoriesType {
    WEAPONS = 'weapon',
    SHIELDS = 'shield',
    ARMORS = 'armor',
    ACCESSORIES = 'accessory',
    RUNES = 'rune',
    OTHER = 'runeword',
  }
  
  export enum ItemCategoriesType {
    WEAPON = 'weapon',
    SHIELD = 'shield',
    ARMOR = 'armor',
    GREAVE = 'greave',
    HELM = 'helm',
    RUNE = 'rune',
    ACCESSORY = 'accessory',
  }
  
  export type ItemDetails = {
    [key: string]: string
  }
  
  export type ItemAttributeMap = {
    [key: string]: string
  }
  
  export type ItemAttribute = {
    id: number
    min: number
    max?: number
    value?: number
    name: string
    map: ItemAttributeMap
  }
  
  export type ItemBranch = {
    description: string | string[]
    attributes: ItemAttribute[]
  }
  
  export type ItemRarity = {
    id: number
    name: string
  }
  
  export type ItemType = {
    id?: number
    name: string
    rarity?: ItemRarity
    category: ItemCategoriesType
    branches?: ItemBranch[]
    icon: string
    video?: string
    value: string
    description: string | string[]
    details?: ItemDetails
    bonus?: ItemsBonusType
    attributes?: ItemAttribute[]
    isNew?: boolean
    isDisabled?: boolean
    tokenId?: string
    tokenIds?: string[]
    isCraftable?: boolean
    isTradeable?: boolean
    isEquipable?: boolean
    isUnequipable?: boolean
    isTransferable?: boolean
    isRuneword?: boolean
    shorthand?: string
    slotId?: number
    perfection?: number
  }
  
  export type ItemsPage = {
    items: ItemType[]
    mainCategory: ItemsMainCategoriesType
    page: number
  }
  
  export type ItemsType = {
    [key: string]: ItemType[]
  }
  